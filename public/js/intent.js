// What the person came to do ("caminho do usuário"): explore the map, get somewhere by
// bike, or get somewhere with accessibility needs. Asked once, on the welcome screen
// (first visit, or again from Camadas › Ajustes), and kept in localStorage as 'intent'.
//
// Choosing an intent sets the map layers and the menu for it; whatever the person
// changes afterwards (layers, planner options) is remembered as usual, so those become
// the defaults from then on. Accessibility is map-only for now: low-floor buses,
// stations and terminals, and a note where the planner would be.

import { toast } from './ui.js';

const KEY = 'intent';
export const INTENTS = {
  explore: { label: 'Explorar o entorno', layers: ['rail', 'stations', 'busRoutes', 'buses', 'parking'] },
  bike: { label: 'Chegar num lugar de bicicleta', layers: ['rail', 'stations', 'busRoutes', 'buses', 'parking'] },
  access: { label: 'Chegar num lugar com acessibilidade', layers: ['stations', 'lowFloor'] },
};

// Saved preferences "Voltar ao padrão" clears (saved places and recent searches stay).
const PREF_KEYS = [KEY, 'hiddenLayers', 'shownLayers', 'baseMaps', 'panelCollapsed', 'planProfile', 'planOptimize',
  'planPower', 'planTimeWeightK', 'planStyle', 'planPrefs', 'planCustomModel', 'planNetworks', 'planAvoidArterials'];
const PREF_PREFIXES = ['sheetHeight:', 'tab:'];

const recall = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

/**
 * setLayers(keys): show exactly these overlay layers (app.js TOGGLES keys).
 * openPanel(): the menu, with the planner open and the destination focused.
 * openLayers(): the layers sheet.
 * skipWelcome: true when the page opened on a shared trip (it answers the question).
 */
export function initIntent({ setLayers, openPanel, openLayers, skipWelcome = false }) {
  const welcome = document.getElementById('welcome');
  const planSection = document.getElementById('plan-section');
  const planDetails = document.getElementById('plan-details');
  const accessNote = document.getElementById('access-note');
  const radios = [...document.querySelectorAll('input[name="intent"]')];
  let returnFocus = null;

  /** The menu for an intent: the planner, or (accessibility) the note in its place. */
  function showMenu(intent) {
    const access = intent === 'access';
    planSection.hidden = access;
    accessNote.hidden = !access;
    // A closed planner doesn't turn map taps into trip points.
    planDetails.open = !access;
    for (const r of radios) r.checked = r.value === intent;
  }

  function choose(intent, { fromWelcome = false } = {}) {
    if (!INTENTS[intent]) return;
    remember(intent);
    setLayers(INTENTS[intent].layers);
    showMenu(intent);
    if (intent === 'bike') openPanel();
    else if (intent === 'explore' && fromWelcome) openLayers();
    if (!fromWelcome) toast(`Mapa ajustado: ${INTENTS[intent].label.toLowerCase()}`);
  }

  function openWelcome() {
    returnFocus = document.activeElement;
    welcome.hidden = false;
    document.body.classList.add('welcome-open');
    welcome.querySelector('button[data-intent]').focus();
  }
  function closeWelcome() {
    welcome.hidden = true;
    document.body.classList.remove('welcome-open');
    returnFocus?.focus?.();
  }

  welcome.addEventListener('click', (e) => {
    const intent = e.target.closest('button[data-intent]')?.dataset.intent;
    if (!intent) return;
    closeWelcome();
    choose(intent, { fromWelcome: true });
  });
  welcome.addEventListener('keydown', (e) => {
    const buttons = [...welcome.querySelectorAll('button[data-intent]')];
    if (e.key === 'Escape') {
      // Closing without a choice is exploring the map, and isn't asked again.
      e.stopPropagation();
      closeWelcome();
      if (!recall()) choose('explore', { fromWelcome: true });
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const i = buttons.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length;
      e.preventDefault();
      buttons[next].focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const i = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
    }
  });

  for (const r of radios) r.addEventListener('change', () => choose(r.value));
  document.getElementById('welcome-again').addEventListener('click', openWelcome);
  document.getElementById('reset-prefs').addEventListener('click', () => {
    if (!confirm('Voltar ao padrão? As camadas, o mapa de fundo e as opções do planejador voltam ao início. Casa, Trabalho e as buscas recentes ficam.')) return;
    try {
      for (const k of PREF_KEYS) localStorage.removeItem(k);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (PREF_PREFIXES.some((p) => k.startsWith(p))) localStorage.removeItem(k);
      }
    } catch {}
    location.reload();
  });

  const saved = recall();
  if (saved && INTENTS[saved]) showMenu(saved);
  else if (!skipWelcome) openWelcome();
  return { intent: () => recall(), openWelcome };
}
