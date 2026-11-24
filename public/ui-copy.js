import {interfaceLabels} from "./ui-labels.js?v=20261123-r64";

const languages=new Set(["en","es","de","ja","fr","pt","ru","it","nl","ko","id","zh","fa"]);
const selected=document.querySelector('meta[name="vetzimo-language"]')?.content;
const attributes=["aria-label","placeholder","title","alt","data-label"];
const preserve="script,style,textarea,code,pre,noscript,iframe,[contenteditable],.vetzimo-language,[data-ui-preserve]";
// Metin kutularının içeriği korunur, yalnız yer tutucu ve etiket öznitelikleri çevrilir.
const fields="textarea,iframe,[contenteditable]";
const clean=value=>value.trim().replace(/\s+/gu," ");

if (languages.has(selected)) {
  start(selected).catch(()=>{ /* A missing catalog leaves the original page usable. */ });
}

async function start(language) {
  const response=await fetch("/ui-copy/"+language+".json?v=r76",{credentials:"same-origin"});
  if (!response.ok) return;
  const published=await response.json();
  const labels=new Map(Object.entries(published));
  for (const [source,text] of Object.entries(interfaceLabels(language))) labels.set(source,text);
  const translated=new WeakMap(), translatedAttrs=new WeakMap();
  const claimed=new Set(labels.values());
  // Kalıplar: "{0} alt menüsü" gibi yer tutuculu anahtarlar değişen metinleri de çevirir.
  const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const patterns=[...labels.keys()].filter(key=>/\{\d\}/.test(key)).map(key=>({
    re:new RegExp("^"+escape(key).replace(/\\\{(\d)\\\}/g,"(?<p$1>.+?)")+"$","u"),
    text:labels.get(key),literal:key.replace(/\{\d\}/g,"").length,dotted:key.includes(" · "),counted:/^(?:\p{L}+ \{0\}|\{0\} \p{L}+)$/u.test(key),
  })).sort((a,b)=>b.literal-a.literal);
  const derived=new Map();
  const lookup=(key,depth=0)=>{
    const exact=labels.get(key);
    if (exact) return exact;
    if (depth>3 || !/\p{L}/u.test(key)) return null;
    if (derived.has(key)) return derived.get(key);
    const viaPatterns=list=>{
      for (const {re,text,counted} of list) {
        const match=key.match(re);
        if (!match) continue;
        // Çevrilemeyen küçük harfli bir parça cümlenin devamıdır; "Randevu {0}" gibi kısa kalıp ona uygulanmaz.
        let loose=false;
        const out=text.replace(/\{(\d)\}/g,(_,i)=>{
          const part=match.groups["p"+i] ?? "", done=lookup(part,depth+1);
          if (!done && /^\p{Ll}/u.test(part) && /\p{L}{3}/u.test(part)) loose=true;
          // "Aşı {0}" ve "{0} satış" gibi tek kelimelik kalıplar, sayı ya da çevrilebilen bir değer bekler.
          if (!done && counted && !/\p{Nd}/u.test(part)) loose=true;
          return done ?? part;
        });
        if (!loose) return out;
      }
      return null;
    };
    const joined=key.includes(" · ");
    let result=joined?viaPatterns(patterns.filter(item=>item.dotted)):null;
    // "Randevu silme · Görüntüleme" gibi birleşik metinler parça parça çevrilir.
    if (!result && joined) {
      const parts=key.split(" · "), out=parts.map(part=>lookup(part,depth+1) ?? part);
      if (out.some((part,i)=>part!==parts[i])) result=out.join(" · ");
    }
    if (!result) result=viaPatterns(joined?patterns.filter(item=>!item.dotted):patterns);
    derived.set(key,result);
    return result;
  };
  const local=value=>{
    const key=clean(value);
    if (claimed.has(key) && !Object.hasOwn(published,key)) return value;
    const text=lookup(key);
    if (!text || text===key) return value;
    return value.replace(/\S(?:[\s\S]*\S)?/u,()=>text);
  };
  function element(node) {
    const previous=translatedAttrs.get(node) ?? new Map();
    for (const name of attributes) {
      const source=node.getAttribute(name);
      if (!source || previous.get(name)===source) continue;
      const text=local(source);
      if (source!==text) {
        previous.set(name,text);
        translatedAttrs.set(node,previous);
        node.setAttribute(name,text);
      }
    }
  }
  function translate(node) {
    if (node.nodeType===Node.TEXT_NODE) {
      const parent=node.parentElement;
      if (!parent || translated.get(node)===node.nodeValue) return;
      const value=local(node.nodeValue);
      if (value!==node.nodeValue) {
        // Keep the original value when a native option has only display text.
        if (parent instanceof HTMLOptionElement && !parent.hasAttribute("value")) parent.value=parent.value;
        translated.set(node,value);
        node.nodeValue=value;
        if (parent.childNodes.length===1 && !parent.hasAttribute("lang") && /^(?:P|H[1-6]|TH|TD|LI|LABEL|SUMMARY|SPAN|BUTTON|STRONG|SMALL|A)$/.test(parent.tagName)) {
          parent.lang=language;
          if (language==="fa" && !parent.hasAttribute("dir")) parent.dir="auto";
        }
      }
    } else if (node.nodeType===Node.ELEMENT_NODE) element(node);
  }
  function walk(node) {
    const root=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
    if (!root) return;
    if (root.closest(preserve)) {
      if (node.nodeType===Node.ELEMENT_NODE && node.matches(fields) && !node.parentElement?.closest(preserve)) element(node);
      return;
    }
    translate(node);
    if (node.nodeType!==Node.ELEMENT_NODE) return;
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
      acceptNode:item=>{
        if (item.nodeType!==Node.ELEMENT_NODE || !item.matches(preserve)) return NodeFilter.FILTER_ACCEPT;
        if (item.matches(fields)) element(item);
        return NodeFilter.FILTER_REJECT;
      },
    });
    while(walker.nextNode()) translate(walker.currentNode);
  }
  document.title=local(document.title);
  walk(document.body);
  document.documentElement.dataset.vetzimoCopy=language;
  new MutationObserver(mutations=>{
    const pending=new Set();
    for (const mutation of mutations) {
      if (mutation.type==="characterData" || mutation.type==="attributes") pending.add(mutation.target);
      else for (const added of mutation.addedNodes) pending.add(added);
    }
    for (const changed of pending) if (changed.isConnected) walk(changed);
  }).observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:attributes});
}
