import {interfaceLabels} from "./ui-labels.js?v=20261123-r64";
const names={
  tr:"Türkçe",en:"English",es:"Español",de:"Deutsch",ja:"日本語",fr:"Français",pt:"Português",
  ru:"Русский",it:"Italiano",nl:"Nederlands",ko:"한국어",id:"Bahasa Indonesia",zh:"中文",fa:"فارسی",
};
const keys="language home features solutions integrations pricing demo contact about faq clinic platform overview appointments clients patients vaccines sales products accounting reports settings manage email phone password otp signIn centerSignIn ownerSignIn clinicSignIn forgot secureExit showChart hideChart".split(" ");
const catalog={
  tr:"Dil|Ana sayfa|Özellikler|Çözümler|Entegrasyonlar|Paketler ve fiyatlar|Ücretsiz Demo|İletişim|Hakkımızda|Sık sorulanlar|Klinik girişi|Klinik yönetim platformu|Genel Bakış|Randevular|Hasta Sahipleri|Hastalar|Aşı Takvimi|Satışlar|Ürünler|Muhasebe|Raporlar|Diğer|Yönet|E-posta|Cep telefonu|Şifre|Doğrulama uygulaması kodu|Giriş yap|Merkez yönetici girişi|Hasta sahibi girişi|VetZimo’ya giriş|Şifremi unuttum|Güvenli çıkış|Grafiği göster|Grafiği gizle",
  en:"Language|Home|Features|Solutions|Integrations|Plans and pricing|Free demo|Contact|About us|FAQ|Clinic login|Clinic management platform|Overview|Appointments|Pet owners|Patients|Vaccination calendar|Sales|Products|Accounting|Reports|More|Manage|Email|Mobile phone|Password|Authenticator code|Sign in|Head office sign-in|Pet owner sign-in|Sign in to VetZimo|Forgot password|Sign out|Show chart|Hide chart",
  es:"Idioma|Inicio|Funciones|Soluciones|Integraciones|Planes y precios|Demo gratuita|Contacto|Quiénes somos|Preguntas frecuentes|Acceso a la clínica|Plataforma de gestión clínica|Resumen|Citas|Propietarios|Pacientes|Calendario de vacunación|Ventas|Productos|Contabilidad|Informes|Más|Gestionar|Correo electrónico|Teléfono móvil|Contraseña|Código de autenticación|Iniciar sesión|Acceso de administración central|Acceso de propietarios|Iniciar sesión en VetZimo|Olvidé mi contraseña|Cerrar sesión|Mostrar gráfico|Ocultar gráfico",
  de:"Sprache|Startseite|Funktionen|Lösungen|Integrationen|Tarife und Preise|Kostenlose Demo|Kontakt|Über uns|Häufige Fragen|Klinik-Login|Plattform für Klinikverwaltung|Übersicht|Termine|Tierhalter|Patienten|Impfkalender|Verkäufe|Produkte|Buchhaltung|Berichte|Mehr|Verwalten|E-Mail|Mobiltelefon|Passwort|Code aus der Authenticator-App|Anmelden|Anmeldung für die Zentrale|Anmeldung für Tierhalter|Bei VetZimo anmelden|Passwort vergessen|Abmelden|Diagramm anzeigen|Diagramm ausblenden",
  ja:"言語|ホーム|機能|ソリューション|連携|プランと料金|無料デモ|お問い合わせ|会社情報|よくある質問|クリニックログイン|クリニック管理プラットフォーム|概要|予約|飼い主|患者|予防接種カレンダー|売上|商品|会計|レポート|その他|管理|メールアドレス|携帯電話|パスワード|認証アプリのコード|ログイン|本部管理者ログイン|飼い主ログイン|VetZimoにログイン|パスワードをお忘れの方|ログアウト|グラフを表示|グラフを非表示",
  fr:"Langue|Accueil|Fonctionnalités|Solutions|Intégrations|Offres et tarifs|Démo gratuite|Contact|À propos|FAQ|Accès clinique|Plateforme de gestion clinique|Vue d’ensemble|Rendez-vous|Propriétaires|Patients|Calendrier vaccinal|Ventes|Produits|Comptabilité|Rapports|Plus|Gérer|Adresse e-mail|Téléphone mobile|Mot de passe|Code de l’application d’authentification|Se connecter|Connexion de l’administration centrale|Connexion des propriétaires|Se connecter à VetZimo|Mot de passe oublié|Se déconnecter|Afficher le graphique|Masquer le graphique",
  pt:"Idioma|Início|Funcionalidades|Soluções|Integrações|Planos e preços|Demonstração gratuita|Contato|Sobre nós|Perguntas frequentes|Acesso à clínica|Plataforma de gestão clínica|Visão geral|Agendamentos|Tutores|Pacientes|Calendário de vacinação|Vendas|Produtos|Contabilidade|Relatórios|Mais|Gerenciar|E-mail|Celular|Senha|Código do autenticador|Entrar|Acesso da administração central|Acesso do tutor|Entrar no VetZimo|Esqueci a senha|Sair|Mostrar gráfico|Ocultar gráfico",
  ru:"Язык|Главная|Возможности|Решения|Интеграции|Тарифы и цены|Бесплатное демо|Контакты|О нас|Частые вопросы|Вход для клиник|Платформа управления клиникой|Обзор|Записи на приём|Владельцы животных|Пациенты|Календарь вакцинаций|Продажи|Товары|Бухгалтерия|Отчёты|Ещё|Управление|Электронная почта|Мобильный телефон|Пароль|Код из приложения для аутентификации|Войти|Вход для центрального офиса|Вход для владельцев животных|Войти в VetZimo|Забыли пароль?|Выйти|Показать график|Скрыть график",
  it:"Lingua|Home|Funzionalità|Soluzioni|Integrazioni|Piani e prezzi|Demo gratuita|Contatti|Chi siamo|Domande frequenti|Accesso clinica|Piattaforma di gestione clinica|Panoramica|Appuntamenti|Proprietari|Pazienti|Calendario delle vaccinazioni|Vendite|Prodotti|Contabilità|Report|Altro|Gestisci|E-mail|Cellulare|Password|Codice dell’app di autenticazione|Accedi|Accesso amministrazione centrale|Accesso proprietari|Accedi a VetZimo|Password dimenticata|Esci|Mostra grafico|Nascondi grafico",
  nl:"Taal|Home|Functies|Oplossingen|Integraties|Abonnementen en prijzen|Gratis demo|Contact|Over ons|Veelgestelde vragen|Inloggen voor klinieken|Platform voor kliniekbeheer|Overzicht|Afspraken|Diereigenaren|Patiënten|Vaccinatiekalender|Verkoop|Producten|Boekhouding|Rapporten|Meer|Beheren|E-mailadres|Mobiele telefoon|Wachtwoord|Code uit de verificatie-app|Inloggen|Inloggen voor hoofdkantoor|Inloggen voor diereigenaren|Inloggen bij VetZimo|Wachtwoord vergeten|Uitloggen|Grafiek tonen|Grafiek verbergen",
  ko:"언어|홈|기능|솔루션|연동|요금제 및 가격|무료 데모|문의|회사 소개|자주 묻는 질문|동물병원 로그인|동물병원 관리 플랫폼|개요|예약|보호자|환자|예방접종 일정|판매|상품|회계|보고서|더 보기|관리|이메일|휴대전화|비밀번호|인증 앱 코드|로그인|본사 관리자 로그인|보호자 로그인|VetZimo 로그인|비밀번호 찾기|로그아웃|그래프 보기|그래프 숨기기",
  id:"Bahasa|Beranda|Fitur|Solusi|Integrasi|Paket dan harga|Demo gratis|Kontak|Tentang kami|Pertanyaan umum|Masuk klinik|Platform pengelolaan klinik|Ringkasan|Janji temu|Pemilik hewan|Pasien|Jadwal vaksinasi|Penjualan|Produk|Akuntansi|Laporan|Lainnya|Kelola|Email|Ponsel|Kata sandi|Kode dari aplikasi autentikasi|Masuk|Masuk admin pusat|Masuk pemilik hewan|Masuk ke VetZimo|Lupa kata sandi|Keluar|Tampilkan grafik|Sembunyikan grafik",
  zh:"语言|首页|功能|解决方案|集成|套餐与定价|免费演示|联系我们|关于我们|常见问题|诊所登录|诊所管理平台|概览|预约|宠物主人|患宠|疫苗接种日历|销售|商品|财务|报表|更多|管理|电子邮件|手机号码|密码|验证器验证码|登录|总部管理员登录|宠物主人登录|登录 VetZimo|忘记密码|退出登录|显示图表|隐藏图表",
  fa:"زبان|خانه|امکانات|راهکارها|یکپارچه‌سازی‌ها|طرح‌ها و قیمت‌ها|دموی رایگان|تماس|درباره ما|پرسش‌های رایج|ورود کلینیک|سامانه مدیریت کلینیک|نمای کلی|نوبت‌ها|صاحبان حیوانات|بیماران|تقویم واکسیناسیون|فروش|محصولات|حسابداری|گزارش‌ها|بیشتر|مدیریت|ایمیل|تلفن همراه|رمز عبور|کد برنامه احراز هویت|ورود|ورود مدیر مرکزی|ورود صاحب حیوان|ورود به VetZimo|فراموشی رمز عبور|خروج|نمایش نمودار|پنهان کردن نمودار",
};
const meta=globalThis.document?.querySelector('meta[name="vetzimo-language"]');
const current=meta?.content;
const language=Object.hasOwn(names,current)?current:"tr";
const words=catalog[language].split("|");
const messages=Object.fromEntries(keys.map((key,index)=>[key,words[index]]));
export const uiText=(key,fallback)=>language==="tr" && fallback!==undefined ? fallback : messages[key] ?? fallback;
export const uiLanguage=language;
const direction=language==="fa"?"rtl":"auto";
const localeLabels=interfaceLabels(language);
export const uiLabel=source=>localeLabels[source] ?? source;
const autoLabel={
  tr:"Otomatik (ülkeye göre)",en:"Automatic (by country)",es:"Automático (por país)",de:"Automatisch (nach Land)",
  ja:"自動（国に応じて）",fr:"Automatique (par pays)",pt:"Automático (por país)",ru:"Автоматически (по стране)",
  it:"Automatico (per paese)",nl:"Automatisch (per land)",ko:"자동 (국가 기준)",id:"Otomatis (menurut negara)",
  zh:"自动（按国家或地区）",fa:"خودکار (بر اساس کشور)",
};
const flagCodes={tr:"TR",en:"EN",es:"ES",de:"DE",ja:"JA",fr:"FR",pt:"PT",ru:"RU",it:"IT",nl:"NL",ko:"KO",id:"ID",zh:"ZH",fa:"FA"};
export function mountLanguageSelect(host) {
  if (!current || !host || host.querySelector(".vetzimo-language") || /#(?:aktivasyon|yenileme)(?:\/|$)/.test(location.hash)) return;
  const container=document.createElement("div");
  container.className="vetzimo-language";
  const visual=document.createElement("span");
  visual.className="vetzimo-language-face";
  visual.setAttribute("aria-hidden","true");
  visual.innerHTML=`<svg class="language-flag" viewBox="0 0 24 16"><use href="/language-flags.svg#${language}"></use></svg><b>${flagCodes[language]}</b><svg class="language-chevron" viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const select=document.createElement("select");
  select.className="vetzimo-language-select";
  select.lang=language;
  select.dir=direction;
  select.setAttribute("aria-label",messages.language);
  select.title=messages.language+" · "+names[language];
  select.add(new Option(autoLabel[language],"auto"));
  for (const [code,name] of Object.entries(names)) {
    const option=new Option(flagCodes[code]+" — "+name,code);
    option.lang=code;
    select.add(option);
  }
  select.value=meta.dataset.mode==="auto"?"auto":language;
  select.addEventListener("change",()=>{
    const next=new URL(location.href);
    next.searchParams.set("lang",select.value);
    location.assign(next);
  });
  container.append(visual,select);
  host.prepend(container);
}
for (const element of globalThis.document?.querySelectorAll("[data-ui-text]") ?? []) {
  if (language==="tr") break;
  const message=messages[element.dataset.uiText];
  if (!message) continue;
  element.textContent=message;
  element.lang=language;
  element.dir=direction;
}
for (const element of globalThis.document?.querySelectorAll("[data-ui-label], .hero-copy .actions a, .site-header button.nav-toggle") ?? []) {
  const message=uiLabel(element.textContent.trim());
  if (message!==element.textContent.trim()) {
    element.textContent=message;
    element.lang=language;
    element.dir=direction;
  }
}
for (const element of globalThis.document?.querySelectorAll("[data-ui-attributes]") ?? []) {
  for (const name of element.dataset.uiAttributes.split(" ")) {
    if (["title","placeholder","aria-label"].includes(name) && element.hasAttribute(name)) {
      element.setAttribute(name,uiLabel(element.getAttribute(name)));
    }
  }
}
const hero=globalThis.document?.querySelector(".hero-copy h1");
if (hero?.firstChild?.nodeType===3 && hero.querySelector("em")) {
  const intro=hero.firstChild.textContent.trim();
  const emphasis=hero.querySelector("em");
  const suffix=emphasis.textContent.trim();
  if (intro==="Kliniğinizin tüm işi" && suffix==="tek çalışma alanında." && language!=="tr") {
    hero.firstChild.textContent=uiLabel(intro)+" ";
    emphasis.textContent=uiLabel(suffix);
    hero.lang=language;
    hero.dir=direction;
  }
}
mountLanguageSelect(globalThis.document?.querySelector("[data-ui-language]"));
