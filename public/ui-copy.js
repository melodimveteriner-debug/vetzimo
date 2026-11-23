import {interfaceLabels} from "./ui-labels.js?v=20261123-r64";

const languages=new Set(["en","es","de","ja","fr","pt","ru","it","nl","ko","id","zh","fa"]);
const selected=document.querySelector('meta[name="vetzimo-language"]')?.content;
const attributes=["aria-label","placeholder","title","alt","data-label"];
const preserve="script,style,svg,textarea,code,pre,noscript,iframe,[contenteditable],.vetzimo-language,[data-ui-preserve]";
const clean=value=>value.trim().replace(/\s+/gu," ");

if (languages.has(selected)) {
  start(selected).catch(()=>{ /* A missing catalog leaves the original page usable. */ });
}

async function start(language) {
  const response=await fetch("/ui-copy/"+language+".json?v=r69",{credentials:"same-origin"});
  if (!response.ok) return;
  const published=await response.json();
  const labels=new Map(Object.entries(published));
  for (const [source,text] of Object.entries(interfaceLabels(language))) labels.set(source,text);
  const translated=new WeakMap(), translatedAttrs=new WeakMap();
  const claimed=new Set(labels.values());
  const local=value=>{
    const key=clean(value), text=labels.get(key);
    if (!text || text===key || (claimed.has(key) && !Object.hasOwn(published,key))) return value;
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
    if (!root || root.closest(preserve)) return;
    translate(node);
    if (node.nodeType!==Node.ELEMENT_NODE) return;
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
      acceptNode:item=>item.nodeType===Node.ELEMENT_NODE && item.matches(preserve)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT,
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
