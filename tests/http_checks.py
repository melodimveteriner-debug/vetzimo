"""Run only against the isolated test harness. Never targets live data."""
import http.client,json,time,urllib.parse,os
base='127.0.0.1:43329'
def request(method,path,data=None,cookie='',origin='https://vetnet.test',scope='',form=False):
    headers={'Origin':origin}
    if cookie: headers['Cookie']=cookie
    if scope: headers['X-Vetnet-Scope']=scope
    if data is not None:
        headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
        data=urllib.parse.urlencode(data) if form else json.dumps(data)
    conn=http.client.HTTPConnection(base,timeout=10)
    conn.request(method,path,data,headers)
    r=conn.getresponse(); result=(r.status,r.read(),r.getheaders()); conn.close(); return result
for i in range(50):
    try:
        assert request('GET','/install.php')[0]==200
        break
    except ConnectionRefusedError: time.sleep(.1)
else: raise RuntimeError('PHP server unavailable')
form=dict(name='HTTP Klinik',phone='05551000005',email='http@example.test',password='Test-install-42-secret',confirmation='Test-install-42-secret',token='t'*48)
assert request('POST','/install.php',form,form=True,origin='https://wrong.test')[0]==403
assert request('POST','/install.php',{**form,'token':'wrong'},form=True)[0]==403
assert request('POST','/install.php',form,form=True)[0]==200
assert request('POST','/install.php',form,form=True)[0]==409
assert request('GET','/')[0]==303
assert b'identity.js' in request('GET','/giris')[1]
status,body,headers=request('POST','/api/identity/phone/login',dict(phone=form['phone'],password=form['password']))
assert status==200,(status,body)
cookies=[v for k,v in headers if k.lower()=='set-cookie']
assert len(cookies)==2 and all('secure' in c.lower() and 'httponly' in c.lower() and 'samesite=strict' in c.lower() for c in cookies)
cookie='; '.join(c.split(';')[0] for c in cookies)
assert b'clinic-start.js' in request('GET','/',cookie=cookie)[1]
status,body,_=request('GET','/api/workspace',cookie=cookie)
data=json.loads(body); state=data['state']; scope=data['session']['scopeId']
state['clients']=[dict(id='client1',name='Test Owner',branch='merkez',phone='05551000033')]
state['patients']=[dict(id='patient1',name='Test Pet',owner='client1',branch='merkez')]
state['appointments']=[dict(id='appointment1',patient='patient1',client='client1',service='Kontrol',date='2026-11-12',branch='merkez')]
state['exams']=[dict(id='exam1',patient='patient1',title='Muayene',date='2026-11-12',branch='merkez')]
state['followups']=[dict(id='followup1',patient='patient1',title='Aşı',date='2026-11-12',branch='merkez',interval='0')]
payload=dict(state=state,revision=data['revision'])
assert request('PUT','/api/workspace',payload,cookie,origin='https://wrong.test',scope=scope)[0]==403
assert request('PUT','/api/workspace',payload,cookie,scope='wrong')[0]==409
status,body,_=request('PUT','/api/workspace',payload,cookie,scope=scope)
assert status==200,(status,body)
assert request('PUT','/api/workspace',payload,cookie,scope=scope)[0]==409
saved=json.loads(request('GET','/api/workspace',cookie=cookie)[1])
assert saved['state']['patients'][0]['id']==state['patients'][0]['id']
assert saved['state']['patients'][0]['createdBy']=='HTTP Klinik'
assert saved['state']['followups'][0]['interval']=='0'
payload['revision']=saved['revision']; state['exams'][0]['date']='2026-02-30'
assert request('PUT','/api/workspace',payload,cookie,scope=scope)[0]==422
# Replay changes produced by the unchanged application model through the PHP API.
with open(os.environ.get('VETNET_FINANCE_FIXTURES','/tmp/vetnet-finance-fixtures.json')) as fixture_file:
    fixtures=json.load(fixture_file)
for fixture in fixtures:
    current=json.loads(request('GET','/api/workspace',cookie=cookie)[1])
    for key,rows in fixture['next'].items():
        if not isinstance(rows,list) or key=='branches': continue
        incoming={r['id']:r for r in rows}
        original={r['id']:r for r in current['state'][key]}
        original.update(incoming)
        current['state'][key]=list(original.values())
    status,body,_=request('PUT','/api/workspace',dict(state=current['state'],revision=current['revision']),cookie,scope=scope)
    assert status==200,(fixture['type'],status,body)
current=json.loads(request('GET','/api/workspace',cookie=cookie)[1])
assert current['state']['products'][0]['stock']=='13'
assert current['state']['sales'][0]['amount']=='225.00'
assert current['state']['collections'][0]['amount']=='125'
print('PASS HTTP product -> sale/stock -> collection -> purchase/stock -> supplier payment -> expense round trip')
assert request('GET','/platform')[0]==200
assert 'Profesyonel'.encode() in request('GET','/platform/paketler')[1]
assert request('GET','/platform/bulunmayan')[0]==404
application=dict(requestId='b54ea679-e50b-49d0-8869-785413aa6123',kind='demo',billing='yearly',plan='profesyonel',
                 notice='basvuru-v1',read='on',email='demo@example.test',phone='+905551000010',name='Test',clinic='Test Klinik')
assert request('POST','/api/saas/applications',application)[0]==200
assert request('POST','/api/saas/applications',application)[0]==200
assert request('POST','/api/saas/applications',{**application,'clinic':'Farklı Klinik'})[0]==409
assert request('GET','/api/cpanel-center/crm',cookie=cookie)[0]==403
assert json.loads(request('GET','/api/saas/my-subscription',cookie=cookie)[1])['status']=='unmanaged'
print('PASS sales pages, demo submission idempotency, CRM access and dealer subscription route')
esmm='/api/clinic/esmm'
assert request('POST',esmm,dict(branch='merkez',provider='gib'),cookie,scope='wrong')[0]==409
assert request('POST',esmm,dict(branch='unknown',provider='gib'),cookie,scope=scope)[0]==403
assert request('POST',esmm,dict(branch='merkez',provider='unknown'),cookie,scope=scope)[0]==422
assert request('POST',esmm,dict(branch='merkez',provider='gib'),cookie,scope=scope)[0]==200
assert json.loads(request('GET',esmm+'?branch=merkez',cookie=cookie)[1])['url']=='https://earsivportal.efatura.gov.tr/'
print('PASS branch-scoped e-SMM portal configuration')
support='/api/support'
assert request('GET','/giris/')[0]==308
ticket=dict(branch='merkez',subject='Kurulum sorusu',department='Destek / Yazılım',urgency='Orta',body='Örnek talep')
status,body,_=request('POST',support,ticket,cookie,scope=scope)
assert status==200,(status,body)
ticket_path=support+'/'+json.loads(body)['id']
assert request('GET',ticket_path)[0]==403
assert request('POST',ticket_path,dict(body='Ek bilgi'),cookie,scope=scope)[0]==200
assert len(json.loads(request('GET',ticket_path,cookie=cookie,scope=scope)[1])['replies'])==2
assert request('POST',ticket_path,dict(action='close'),cookie,scope=scope)[0]==200
assert request('POST',ticket_path,dict(body='Kapalı talep'),cookie,scope=scope)[0]==409
print('PASS scoped clinic support creation, thread, reply and closure')
path='/api/ops/templates'
status,body,_=request('GET',path,cookie=cookie,scope=scope)
assert status==200,(status,body)
assert json.loads(body)['templates']
template=dict(title='Klinik test şablonu',category='patient',body='{{hasta}}',active=True)
assert request('POST',path+'/save',template,cookie,scope='wrong')[0]==403
status,body,_=request('POST',path+'/save',template,cookie,scope=scope)
assert status==200,(status,body)
template_id=json.loads(body)['id']
assert any(row['id']==template_id for row in json.loads(request('GET',path,cookie=cookie,scope=scope)[1])['templates'])
assert request('POST',path+'/delete',dict(id=template_id),cookie,scope=scope)[0]==200
assert request('POST',path+'/delete',dict(id='system-vaccine'),cookie,scope=scope)[0]==422
print('PASS clinical print templates: defaults, scoped save, listing and delete')
assert request('GET','/api/cpanel-center/partners',cookie=cookie)[0]==403
status,body,_=request('POST','/api/identity/invite',dict(phone='05551000033',role='customer',branchId='merkez',customerId='client1',name='Test Owner',method='in-person',verifiedInPerson=True,modules=dict(vaccines='read',appointments='read')),cookie,scope=scope)
assert status==200,(status,body)
activation=json.loads(body)['link'].split('/')[-1]
assert request('POST','/api/identity/phone/redeem',dict(token=activation,password='Customer-test-password-42'))[0]==200
status,body,owner_headers=request('POST','/api/identity/phone/login',dict(phone='05551000033',password='Customer-test-password-42'))
assert status==200 and json.loads(body)['destination']=='/hasta-sahibi'
owner_cookie='; '.join(v.split(';')[0] for k,v in owner_headers if k.lower()=='set-cookie')
assert request('GET','/api/workspace',cookie=owner_cookie)[0]==403
status,body,_=request('GET','/api/identity/portal',cookie=owner_cookie)
assert status==200,(status,body)
assert [p['id'] for p in json.loads(body)['pets']]==['patient1']
assert request('GET','/api/identity/directory',cookie=owner_cookie)[0]==403
print('PASS HTTP customer invitation, activation, login, scoped portal and denial from clinic/center management')
assert request('POST','/api/identity/logout',{},cookie)[0]==200
assert request('GET','/api/workspace',cookie=cookie)[0]==403
status,body,headers=request('POST','/api/identity/phone/login',dict(phone=form['phone'],password=form['password']))
assert status==200
cookie='; '.join(v.split(';')[0] for k,v in headers if k.lower()=='set-cookie')
profile=json.loads(request('GET','/api/identity/profile',cookie=cookie)[1])
assert profile['name']=='HTTP Klinik'
assert request('GET','/api/staff/clinic-names?branch=other',cookie=cookie)[0]==404
assert json.loads(request('GET','/api/staff/clinic-names?branch=merkez',cookie=cookie)[1])['names']==['HTTP Klinik']
assert request('POST','/api/identity/password/change',dict(currentPassword='wrong',password='New-test-password-42'),cookie)[0]==403
assert request('POST','/api/identity/password/change',dict(currentPassword=form['password'],password='New-test-password-42'),cookie)[0]==200
assert request('GET','/api/workspace',cookie=cookie)[0]==403
assert request('POST','/api/identity/phone/login',dict(phone=form['phone'],password=form['password']))[0]==401
assert request('POST','/api/identity/phone/login',dict(phone=form['phone'],password='New-test-password-42'))[0]==200
print('PASS profile, clinician names, password change, old-password rejection and session revocation')
print('PASS HTTP installation, setup lock, origin protection, secure cookies, authenticated HTML, five clinical collections, revision conflict, invalid date, logout')
