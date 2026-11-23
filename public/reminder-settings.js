export const reminderCatalog = [
  ["followups","Aşı hatırlatıcısı","Planlanan aşı tarihinden önce","{hasta} için {tarih} tarihinde {islem} aşısı planlandı. {klinik}"],
  ["unpaid","Ödenmemiş Satış Hatırlatması","Vadesi yaklaşan veya ödenmemiş satışlar","Sayın {musteri}, {klinik} nezdindeki {tutar} tutarındaki açık satış bakiyenizi hatırlatırız."],
  ["balance","Bakiye Hatırlatma","Cari bakiye için elle kullanım","Sayın {musteri}, {klinik} nezdindeki güncel bakiyeniz {tutar}."],
  ["collections","Yeni Tahsilat Bilgilendirmesi","Yeni tahsilat kaydından sonra","Sayın {musteri}, {tarih} tarihinde {tutar} tutarındaki ödemeniz alındı. {klinik}"],
  ["appointments","Randevu hatırlatıcısı","Randevu başlamadan önce","{hasta} için randevunuz {tarih}. {klinik}"],
  ["welcome","Hoş Geldin Mesajı","Yeni müşteri formunda SMS gönder seçildiğinde","Sayın {musteri}, {klinik} ailesine hoş geldiniz."],
  ["patientBirthday","Hasta Doğum Günü Mesajı","Hastanın doğum gününde","{hasta} için mutlu yıllar dileriz. {klinik}"],
  ["customerBirthday","Müşteri Doğum Günü Mesajı","Müşterinin doğum gününde","Sayın {musteri}, doğum gününüz kutlu olsun. {klinik}"],
  ["appointmentNew","Yeni Randevu","Randevu oluşturulduğunda","{hasta} için {tarih} tarihine randevu oluşturuldu. {klinik}"],
  ["appointmentChanged","Randevu Güncellemesi","Randevu tarihi veya saati değiştiğinde","{hasta} için randevunuz {tarih} olarak güncellendi. {klinik}"],
];

export const reminderChannels = [["sms","SMS"],["whatsapp","WhatsApp"],["mobile","Mobil bildirim"],["email","E-posta"]];

export function reminderDefaults(prefs,key,channel) {
  return key==="appointments" && ["sms","whatsapp"].includes(channel) && prefs.reminder_appointments==="Evet" ? (prefs["reminder_"+channel] || "Hayır") : "Hayır";
}

export function reminderSettingsMarkup(prefs,escape) {
  const rows = reminderCatalog.map(([key,label,detail,template]) => {
    const setting = field => "customerReminder_"+key+"_"+field;
    const mode = prefs[setting("mode")] || (key==="appointments" && prefs.reminder_appointments==="Evet" ? "auto" : "off");
    const supported = ["appointments","followups","patientBirthday","customerBirthday"].includes(key);
    const channelState = channel => prefs[setting(channel)] || reminderDefaults(prefs,key,channel);
    return `<tr><td><strong>${label}</strong><br><small>${detail}</small></td>
      <td>${{auto:"Açık / Otomatik",manual:"Manuel",off:"Kapalı"}[mode]||"Kapalı"}${supported?"":'<br><small>Manuel şablon</small>'}</td>
      <td>${reminderChannels.map(([channel,name])=>`<span class="reminder-chip ${channelState(channel)==="Evet"?"on":""}">${name} · ${channelState(channel)==="Evet"?"Açık":"Kapalı"}</span>`).join("")}</td>
      <td><details><summary>Düzenle</summary><div class="reminder-fields">
      <label>Gönderim modu<select name="${setting("mode")}">
      ${[["off","Kapalı"],["manual","Manuel"],...(supported?[["auto","Otomatik"]]:[])].map(([value,text])=>`<option value="${value}" ${mode===value?"selected":""}>${text}</option>`).join("")}</select></label>
      ${reminderChannels.map(([channel,name])=>`<label>${name}<select name="${setting(channel)}"><option value="Hayır">Kapalı</option><option value="Evet" ${channelState(channel)==="Evet"?"selected":""}>Açık</option></select></label>`).join("")}
      ${supported?`<label>${key.endsWith("Birthday")?"Gönderim saati":"Kaç saat önce?"}<input name="${setting("schedule")}" type="${key.endsWith("Birthday")?"time":"number"}" min="1" max="168" required value="${escape(prefs[setting("schedule")] || (key.endsWith("Birthday")?"10:00":"24"))}"></label>`:""}
      <label>${key==="welcome"?"Hoş geldin SMS metni":"SMS ve e-posta metni"}<textarea name="${setting("text")}" maxlength="420" required>${escape(prefs[setting("text")] || template)}</textarea></label>
      <label>Onaylı WhatsApp şablon adı<input name="${setting("waTemplate")}" maxlength="128" pattern="[a-z0-9_]+" value="${escape(prefs[setting("waTemplate")] || "")}"></label>
      ${key==="welcome"?'<small>İlk giriş numarası, otomatik şifre ve giriş bağlantısı SMS’e otomatik eklenir.</small>':""}
      <small>Kullanılabilir alanlar {musteri}, {hasta}, {tarih}, {islem}, {tutar}, {klinik}. WhatsApp gövde sırası: hasta veya müşteri, tarih ve saat, klinik.</small>
      </div></details></td></tr>`;
  }).join("");
  return `<form id="customerReminderForm" class="panel"><p>Gönderimde müşterinin kanal izni aranır. Mobil bildirim tercihi saklanır. Manuel modda metni Düzenle bölümünden kopyalayabilirsiniz.</p><div class="table-wrap"><table><thead><tr><th>Hatırlatıcı</th><th>Gönderim</th><th>Kanallar</th><th>İşlemler</th></tr></thead><tbody>${rows}</tbody></table></div><p id="customerReminderError" role="alert"></p><button class="button primary" type="submit">Hatırlatıcıları kaydet</button></form>`;
}
