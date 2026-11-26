// Satış sitesi iletişim formu: toplama/çıkarma güvenlik sorusu, karakter sayacı, gönderim ve teşekkür kartı.
const form = document.querySelector("[data-site-contact]");
if (form) {
  const done = form.parentElement.querySelector(".vzc-done");
  const question = form.querySelector("[data-question]");
  const feedback = form.querySelector(".vzc-feedback");
  const message = form.elements.message;
  const counter = form.querySelector("[data-count]");
  const submit = form.querySelector('button[type="submit"]');
  let token = "";

  const say = (text, tone = "") => { feedback.textContent = text; feedback.dataset.tone = tone; };
  async function newQuestion() {
    question.textContent = "…";
    form.elements.answer.value = "";
    try {
      const res = await fetch("/api/site-contact/challenge", { cache: "no-store", headers: { Accept: "application/json" } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "");
      token = data.token;
      question.textContent = data.question;
    } catch {
      question.textContent = "yüklenemedi";
      say("Güvenlik sorusu yüklenemedi. ↻ ile yenileyin.", "error");
    }
  }
  const count = () => { counter.textContent = message.value.length + " / 4000"; };
  message.addEventListener("input", count);
  form.querySelector("[data-refresh]").addEventListener("click", newQuestion);
  form.elements.answer.addEventListener("input", () => { form.elements.answer.value = form.elements.answer.value.replace(/[^0-9-]/g, ""); });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    say("");
    for (const field of form.querySelectorAll("[aria-invalid]")) field.removeAttribute("aria-invalid");
    const invalid = [...form.querySelectorAll("input[required],select[required],textarea[required]")].find(field =>
      field.type === "checkbox" ? !field.checked : !field.value.trim() || !field.checkValidity());
    if (invalid) {
      invalid.setAttribute("aria-invalid", "true");
      invalid.focus();
      say(invalid.name === "consent" ? "Aydınlatma metnini okuduğunuzu onaylayın." :
        invalid.name === "answer" ? "Güvenlik sorusunu yanıtlayın." :
        invalid.name === "email" ? "Geçerli bir e-posta adresi yazın." :
        invalid.name === "message" ? "Mesajınız en az 10 karakter olmalıdır." : "Zorunlu alanları doldurun.", "error");
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    data.consent = form.elements.consent.checked;
    data.token = token;
    submit.disabled = true;
    submit.textContent = "Gönderiliyor…";
    try {
      const res = await fetch("/api/site-contact", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Mesaj gönderilemedi. Lütfen tekrar deneyin.");
      form.reset(); count();
      form.hidden = true;
      done.hidden = false;
      done.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    } catch (error) {
      say(error.message, "error");
      if (/güvenlik|soru/i.test(error.message)) form.elements.answer.setAttribute("aria-invalid", "true");
      newQuestion();
    } finally {
      submit.disabled = false;
      submit.textContent = "Mesajı gönder";
    }
  });
  done.querySelector("[data-again]").addEventListener("click", () => { done.hidden = true; form.hidden = false; newQuestion(); form.elements.name.focus(); });
  newQuestion();
}
