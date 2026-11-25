export const defaultTheme = "#dcd8f4";
export const validTheme = value => typeof value==="string" && /^#[0-9a-f]{6}$/i.test(value);

export function themeColors(value) {
  const selected=validTheme(value) ? value.toLowerCase() : defaultTheme;
  const channels=selected.slice(1).match(/../g).map(hex=>parseInt(hex,16)/255);
  const [red,green,blue]=channels.map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4);
  const luminance=0.2126*red+0.7152*green+0.0722*blue;
  const foreground=(luminance+0.05)/0.05 >= 1.05/(luminance+0.05) ? "#000000" : "#ffffff";
  return {selected,foreground};
}

export function applyTheme(value) {
  const {selected,foreground}=themeColors(value);
  document.documentElement.style.setProperty("--brand-bg",selected);
  document.documentElement.style.setProperty("--brand-fg",foreground);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",selected);
}

export const sitePalettes=[
  ["orchid","Orkide · Safir","#713fa9"],
  ["prizma","Prizma · Işıltı","#6a3df0"],
  ["nebula","Nebula · Neon Gece","#6d4bf5"],
];
export const validPalette=value=>sitePalettes.some(([key])=>key===value);
export const paletteColor=value=>sitePalettes.find(([key])=>key===value)?.[2]||defaultTheme;
export const darkPalette=value=>value==="nebula";
export const defaultAppearance={palette:"",locked:false};

export async function loadAppearance(options) {
  try {
    const response=await fetch("/api/saas/appearance",options);
    return response.ok?await response.json():defaultAppearance;
  } catch {return defaultAppearance;}
}
