export const okcScenarios={
  success:"Başarılı ödeme", decline:"Reddedilen ödeme", disconnect:"Bağlantı kesildi", timeout:"Zaman aşımı",
  fiscal:"Ödeme başarılı, mali belge başarısız", busy:"Cihaz meşgul", wrong_pairing:"Yanlış cihaz eşleştirmesi",
};

const complete={status:"completed",payment:"paid",fiscal:"simulated"};

// Live adapters implement this contract using manufacturer-approved transports.
export const okcOperations=Object.freeze(["connection","pair","start","query","fiscalDocument","cancel","refund","fiscalDayEnd","bankDayEnd"]);

const simulation=Object.freeze({
  version:"1", methods:["cash","card"],
  capabilities:["connection","pair","start","query","cancel","refund"],
  connection(device) { return device.active && device.state==="paired"?"simulation_ready":device.state; },
  pair() {return "paired";},
  start() {return {status:"awaiting",payment:"pending",fiscal:"pending"};},
  query(tx) {
    if (tx.status==="review" && ["disconnect","timeout"].includes(tx.scenario)) return complete;
    if (tx.status!=="awaiting") return null;
    switch (tx.scenario) {
      case "success":return complete;
      case "decline":return {status:"declined",payment:"declined",fiscal:"none"};
      case "disconnect":
      case "timeout":return {status:"review",payment:"unknown",fiscal:"pending"};
      case "fiscal":return {status:"fiscal_missing",payment:"paid",fiscal:"failed"};
      default:return {status:"failed",payment:"failed",fiscal:"none"};
    }
  },
  reconcile(tx) {return tx.status==="fiscal_missing"?complete:null;},
  cancel(tx) {
    return tx.status==="awaiting"?{status:"cancelled",payment:"cancelled",fiscal:"none"}:null;
  },
  refund(tx,amount) {
    if (!["completed","partially_refunded"].includes(tx.status) || amount<=0 || amount>tx.amount-tx.refunded) return null;
    const refunded=tx.refunded+amount, status=refunded===tx.amount?"refunded":"partially_refunded";
    return {status,payment:status,fiscal:tx.fiscal,refunded};
  },
});
export const okcAdapters=Object.freeze({simulation});
