try {
  await import("./app.js?v=20261126-r133");
} catch (error) {
  console.error("Klinik paneli başlatılamadı.",error);
  const main=document.getElementById("main");
  const message=document.createElement("p");
  message.setAttribute("role","alert");
  message.textContent="Klinik paneli başlatılamadı. Sayfayı yenileyerek tekrar deneyin.";
  const retry=document.createElement("button");
  retry.type="button";
  retry.className="button primary";
  retry.textContent="Tekrar dene";
  retry.addEventListener("click",()=>location.reload());
  main.replaceChildren(message,retry);
}
