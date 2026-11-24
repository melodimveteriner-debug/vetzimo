<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;

final class ClinicRecordDeletion
{
    public function __construct(private readonly PDO $db) {}

    public function apply(object $state, string $partner, string $collection, string $id): void
    {
        $owner = $collection === 'clients' ? $id : '';
        $patients = $owner === '' ? [$id => true] : [];
        foreach ($state->patients ?? [] as $patient) {
            if ($owner !== '' && ($patient->owner ?? '') === $owner) $patients[$patient->id] = true;
        }

        $belongs = static function (object $row) use ($owner, $patients): bool {
            return isset($patients[$row->patient ?? '']) || ($owner !== '' &&
                in_array($owner, [$row->client ?? '', $row->customer ?? '', $row->owner ?? ''], true));
        };

        $removed = ['visits' => $this->deleteVisits($partner, $owner, $patients)];
        $discard = static function (string $type, array $rows, callable $matches) use (&$removed): array {
            $remaining = [];
            foreach ($rows as $row) {
                if ($matches($row)) $removed[$type][$row->id] = true;
                else $remaining[] = $row;
            }
            return $remaining;
        };
        $byVisit = static fn(object $row): bool => isset($removed['visits'][$row->visitId ?? '']);
        $state->clients = $discard('clients', $state->clients ?? [], static fn($row) => $row->id === $owner);
        $state->patients = $discard('patients', $state->patients ?? [], static fn($row) => isset($patients[$row->id]));

        $state->exams = $discard('exams', $state->exams ?? [], $belongs);
        $state->appointments = $discard('appointments', $state->appointments ?? [],
            static fn($row) => $belongs($row) || isset($removed['exams'][$row->controlExamId ?? '']) ||
                (str_starts_with($row->id, 'visit-') && isset($removed['visits'][substr($row->id, 6)])));
        $state->exams = $discard('exams', $state->exams,
            static fn($row) => isset($removed['appointments'][$row->appointmentId ?? '']));
        $state->appointments = $discard('appointments', $state->appointments,
            static fn($row) => isset($removed['exams'][$row->controlExamId ?? '']));
        $related = static fn(object $row): bool => $belongs($row) || $byVisit($row) ||
            isset($removed['exams'][$row->examId ?? $row->exam ?? '']) || isset($removed['appointments'][$row->appointmentId ?? '']);
        foreach (['labs','followups','weights','treatments','prescriptions','stays','surgeries','documents','messages','visitors','clinicNotes'] as $type) {
            if (isset($state->$type)) $state->$type = $discard($type, $state->$type, $related);
        }

        $sales = [];
        foreach ($state->sales ?? [] as $sale) {
            if (!$related($sale) && !(str_starts_with($sale->id, 'visit-') && isset($removed['visits'][substr($sale->id, 6)]))) continue;
            $sales[$sale->id] = true;
            $sale->client = $sale->patient = '';
            $sale->detail = 'Müşterisiz satış';
            unset($sale->examId, $sale->appointmentId, $sale->visitId, $sale->privateNotes, $sale->publicNotes);
        }
        foreach ($state->collections ?? [] as $payment) {
            if (!isset($sales[$payment->sale ?? '']) && !$related($payment)) continue;
            unset($payment->client, $payment->customer, $payment->patient, $payment->notes, $payment->visitId);
        }

        foreach ($removed as $type => $ids) {
            if ($type==='appointments') continue;
            foreach ($ids as $record => $_) {
                foreach ($this->noticeTargets($type, $record) as $target) {
                    $this->execute('DELETE FROM clinic_delivery_notice WHERE partner_id=? AND target=?', [$partner,$target]);
                }
            }
        }
        $this->deleteFilesAndShares($partner, $removed);
        foreach (array_keys($removed['appointments'] ?? []) as $appointment) {
            $this->deleteAppointmentData($partner,$appointment);
        }
        foreach ($this->scopes($owner, $patients) as [$column, $value]) {
            $this->execute("DELETE n FROM clinic_delivery_notice n JOIN clinic_homecare_checkin c
                ON n.partner_id=c.partner_id AND n.dedupe=SHA2(CONCAT('homecare:reply:',c.id),256)
                WHERE c.partner_id=? AND c.$column=?", [$partner,$value]);
            $this->execute("DELETE FROM clinic_homecare_checkin WHERE partner_id=? AND $column=?", [$partner,$value]);
            $this->execute("DELETE FROM clinic_homecare_plan WHERE partner_id=? AND $column=?", [$partner,$value]);
        }
        if ($owner !== '') $this->deleteMemberships($partner,$owner);
    }

    public function deleteAppointmentData(string $partner, string $appointment): void
    {
        foreach ($this->noticeTargets('appointments',$appointment) as $target) {
            $this->execute('DELETE FROM clinic_delivery_notice WHERE partner_id=? AND target=?',[$partner,$target]);
        }
        if (!preg_match('/\Aweb-[a-f0-9]{32}\z/D', $appointment)) return;
        $this->execute('DELETE FROM clinic_delivery_notice WHERE partner_id=? AND dedupe=SHA2(?,256)',
            [$partner,'web-book:'.$appointment]);
        $this->execute("DELETE FROM clinic_delivery_notice WHERE partner_id=? AND kind='guest'
            AND target LIKE CONCAT('/web/%/randevu?kayit=',?)", [$partner,$appointment]);
        // Legacy guest notices linked to a page alone can be attributed by their revision key.
        $this->execute("DELETE n FROM clinic_delivery_notice n JOIN clinic_audit a ON a.partner_id=n.partner_id
            AND a.created_at BETWEEN n.created_at AND n.created_at + INTERVAL 1 MINUTE
            AND n.dedupe=SHA2(CONCAT('appointment:guest:',a.revision,':',?),256)
            WHERE n.partner_id=? AND n.kind='guest' AND a.action='workspace.saved'", [$appointment,$partner]);
        foreach (['clinic_web_mail','clinic_web_appointment_event','clinic_web_appointment'] as $table) {
            $column = $table === 'clinic_web_appointment' ? 'id' : 'appointment_id';
            $this->execute("DELETE FROM $table WHERE partner_id=? AND $column=?", [$partner,$appointment]);
        }
    }

    public function deleteVisit(string $partner, string $id): void
    {
        foreach (['clinic_visit_read','clinic_visit_mail'] as $table) {
            $this->execute("DELETE child FROM $table child JOIN clinic_visit_event e ON child.event_id=e.id
                WHERE e.partner_id=? AND e.visit_id=?",[$partner,$id]);
        }
        foreach (['clinic_visit_slot','clinic_visit_payment','clinic_visit_quote','clinic_visit_event'] as $table) {
            $this->execute("DELETE child FROM $table child JOIN clinic_visit_request r ON r.id=child.visit_id
                WHERE r.partner_id=? AND r.id=?",[$partner,$id]);
        }
        $this->execute('DELETE FROM clinic_visit_request WHERE partner_id=? AND id=?',[$partner,$id]);
        $this->execute("DELETE FROM clinic_delivery_notice WHERE partner_id=? AND target=? AND kind IN ('native_visit_clinic','native_visit_owner')",
            [$partner,'/evde-hizmet/uygulama/'.$id]);
    }

    private function deleteVisits(string $partner, string $owner, array $patients): array
    {
        $ids = [];
        foreach ($this->scopes($owner, $patients) as [$column,$value]) {
            $query = $this->db->prepare("SELECT id FROM clinic_visit_request WHERE partner_id=? AND $column=? FOR UPDATE");
            $query->execute([$partner,$value]);
            foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $id) {
                $ids[$id] = true;
                $this->deleteVisit($partner,$id);
            }
        }
        return $ids;
    }

    private function scopes(string $owner, array $patients): iterable
    {
        if ($owner !== '') yield ['customer_id',$owner];
        foreach ($patients as $id => $_) yield ['patient_id',$id];
    }

    private function deleteFilesAndShares(string $partner, array $removed): void
    {
        foreach (['exams'=>['clinic_exam_photos','exam_id',['exam']],
                  'labs'=>['clinic_lab_attachment','lab_id',['lab','xray']]] as $type => [$table,$column,$categories]) {
            foreach ($removed[$type] ?? [] as $id => $_) {
                $this->execute("DELETE FROM $table WHERE partner_id=? AND $column=?", [$partner,$id]);
                foreach ($categories as $category) {
                    $this->execute('DELETE s FROM clinic_portal_share s JOIN identity_membership m ON m.id=s.membership_id
                        WHERE m.partner_id=? AND s.category=? AND s.record_id=?', [$partner,$category,$id]);
                }
            }
        }
    }

    private function noticeTargets(string $type, string $id): array
    {
        $id = rawurlencode($id);
        return match ($type) {
            'appointments' => ['/clinic#record/appointments/'.$id, '/hasta-sahibi?bildirim=appointments&kayit='.$id],
            'stays', 'followups', 'surgeries' => ['/clinic#record/'.$type.'/'.$id],
            'patients' => ['/clinic#patient/'.$id.'/homecare'],
            'exams', 'labs' => ['/hasta-sahibi?bildirim=health&kayit='.$id],
            default => [],
        };
    }

    private function deleteMemberships(string $partner, string $owner): void
    {
        $query = $this->db->prepare("SELECT id,account_id FROM identity_membership
            WHERE partner_id=? AND customer_id=? AND role='customer' FOR UPDATE");
        $query->execute([$partner,$owner]);
        foreach ($query->fetchAll() as $member) {
            foreach (['identity_session','identity_activation','clinic_visit_read'] as $table) {
                $this->execute("DELETE FROM $table WHERE membership_id=?", [$member['id']]);
            }
            $this->execute('DELETE FROM identity_membership WHERE partner_id=? AND id=?', [$partner,$member['id']]);
            $this->execute("DELETE p FROM vetnet_appearance p JOIN identity_account a ON p.scope_key=CONCAT('account:',a.id)
                WHERE a.id=? AND a.kind='phone' AND NOT EXISTS(SELECT 1 FROM identity_membership m WHERE m.account_id=a.id)",
                [$member['account_id']]);
            $this->execute("UPDATE identity_account a SET identifier=CONCAT('deleted-',a.id),password_hash=NULL,
                verified_at=NULL,phone_verified_at=NULL,blocked=1,version=version+1 WHERE a.id=? AND a.kind='phone'
                AND NOT EXISTS(SELECT 1 FROM identity_membership m WHERE m.account_id=a.id)", [$member['account_id']]);
        }
        $this->execute('DELETE FROM clinic_delivery_notice WHERE partner_id=? AND customer_id=?', [$partner,$owner]);
    }

    private function execute(string $sql, array $values): void
    {
        $this->db->prepare($sql)->execute($values);
    }
}
