const FALLBACK_ICONS: Record<string, string> = {
  cursor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.6 2.2c-.9-.5-2-.5-2.9 0l-6 3.4c-.9.5-1.5 1.5-1.5 2.6v7.7c0 1.1.6 2.1 1.5 2.6l6 3.4c.9.5 2 .5 2.9 0l6-3.4c.9-.5 1.5-1.5 1.5-2.6V8.2c0-1.1-.6-2.1-1.5-2.6l-6-3.4zM12 5.8l5.3 3L12 11.9 6.7 8.8 12 5.8z"/></svg>',
  wall: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16v16H4zM4 8h16M8 4v16"/></svg>',
  door: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4h10v16H7zM14 12h2"/></svg>',
  window: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16v16H4zM4 8h16M8 4v16"/></svg>',
  crosshairs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2v4m0 12v4M2 12h4m12 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8"/></svg>',
  polygon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 7l8-3 8 3v10l-8 3-8-3z"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5h5v2H7v3H5zM19 5h-5v2h3v3h2zm-14 14h5v-2H7v-3H5zm14 0h-5v-2h3v-3h2z"/></svg>',
  label: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5h8l6 7-6 7H5z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 8a6 6 0 1 1 0 12h-2v-2h2a4 4 0 1 0 0-8h-2l3-3 3 3H7z"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 8a6 6 0 1 1 0 12h2v-2h-2a4 4 0 1 0 0-8h2l-3-3-3 3h2z"/></svg>',
  cog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8 3.5-.9-1.9 1.1-1.9-2-2-1.9 1.1-1.9-.9a8.2 8.2 0 0 0-1.3-1.3L13 2h-2l-.9 1.9a8.2 8.2 0 0 0-1.3 1.3L7 4.2 5 5.2l1.1 1.9-.9 1.9a8.2 8.2 0 0 0-1.3 1.3L2 10v2l1.9.9a8.2 8.2 0 0 0 1.3 1.3L5 16.8l2 2 1.9-1.1 1.9.9a8.2 8.2 0 0 0 1.3 1.3L10 22h2l.9-1.9a8.2 8.2 0 0 0 1.3-1.3l1.9 1.1 2-2-1.1-1.9.9-1.9a8.2 8.2 0 0 0 1.3-1.3L22 12v-2l-1.9-.9a8.2 8.2 0 0 0-1.3-1.3z"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 11h14v2H5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5h5v2H7v3H5zm14 0h-5v2h3v3h2zM5 19h5v-2H7v-3H5zm14 0h-5v-2h3v-3h2z"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 2a8 8 0 1 1-8 8 8 8 0 0 1 8-8zm1 2h-2v8h2z"/></svg>',
  lightbulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a5.5 5.5 0 0 0-3.8 9.4c.6.6 1 1.4 1.1 2.2V15h5.4v-.4c.1-.8.5-1.6 1.1-2.2A5.5 5.5 0 0 0 12 3zm-2 13h4v1H10zm0 2h4v1H10z"/></svg>',
  blinds: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 3h18v18H3zm2 2v2h14V5zm0 4v2h14V9zm0 4v2h14v-2zm0 4v2h14v-2z"/></svg>',
  radiobox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9zm0 2a7 7 0 1 1-7 7 7 7 0 0 1 7-7zm0 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 9l4 4 4-4"/></svg>',
  circle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
};

export function iconToMdiClass(icon: string | undefined, fallback = "mdi:circle"): string {
  const value = (icon ?? fallback).trim();
  const normalized = value.startsWith("mdi:") ? value.slice(4) : value;
  const cleaned = normalized.replace(/^mdi\s*[:.-]?/i, "").trim();
  return cleaned ? `mdi mdi-${cleaned}` : "mdi mdi-circle";
}

export function iconFallbackGlyph(icon: string | undefined, fallback = "mdi:circle"): string {
  const value = (icon ?? fallback).trim();
  const normalized = value.startsWith("mdi:") ? value.slice(4) : value;
  const cleaned = normalized.replace(/^mdi\s*[:.-]?/i, "").trim();
  const key = cleaned.split(/[-_\s]+/).find(Boolean)?.toLowerCase() ?? "";
  return FALLBACK_ICONS[key] ?? FALLBACK_ICONS.circle;
}
