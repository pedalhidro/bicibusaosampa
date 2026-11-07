// What the person came to do ("caminho do usuário"): explore the map, get somewhere by
// bike, or get somewhere with accessibility needs. Asked on the welcome screen, kept in
// localStorage as 'intent'. The screen opens on every visit while "Mostrar esta tela
// nas próximas vezes" is ticked (the default; 'welcomeEvery' = '0' when not), and
// always from Camadas › Ajustes.
//
// Choosing an intent sets the map layers and the menu for it; whatever the person
// changes afterwards (layers, planner options) is remembered as usual, so those become
// the defaults from then on. Accessibility is map-only for now: low-floor buses,
// stations and terminals, and a note where the planner would be.

import { toast } from './ui.js';

const KEY = 'intent';
const EVERY = 'welcomeEvery';
export const INTENTS = {
  explore: { label: 'Explorar o entorno', layers: ['rail', 'stations', 'busRoutes', 'buses', 'parking'] },
  bike: { label: 'Chegar num lugar de bicicleta', layers: ['rail', 'stations', 'busRoutes', 'buses', 'parking'] },
  access: { label: 'Chegar num lugar com acessibilidade', layers: ['stations', 'lowFloor'] },
};

// Saved preferences "Voltar ao padrão" clears (saved places and recent searches stay).
const PREF_KEYS = [KEY, EVERY, 'hiddenLayers', 'shownLayers', 'baseMaps', 'panelCollapsed', 'planProfile', 'planOptimize',
  'planPower', 'planTimeWeightK', 'planStyle', 'planPrefs', 'planCustomModel', 'planNetworks', 'planAvoidArterials'];
const PREF_PREFIXES = ['sheetHeight:', 'tab:'];

const recall = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
const everyVisit = () => { try { return localStorage.getItem(EVERY) !== '0'; } catch { return true; } };

/**
 * setLayers(keys): show exactly these overlay layers (app.js TOGGLES keys).
 * openPanel(): the menu, with the planner open and the destination focused.
 * openLayers(): the layers sheet.
 * skipWelcome: true when the page opened on a shared trip (it answers the question,
 * and keeps the planner open).
 */
export function initIntent({ setLayers, openPanel, openLayers, skipWelcome = false }) {
  const welcome = document.getElementById('welcome');
  const planSection = document.getElementById('plan-section');
  const planDetails = document.getElementById('plan-details');
  const accessNote = document.getElementById('access-note');
  const radios = [...document.querySelectorAll('input[name="intent"]')];
  // The same switch on the welcome screen and in Ajustes.
  const everyBoxes = [...document.querySelectorAll('input[data-welcome-every]')];
  for (const b of everyBoxes) {
    b.checked = everyVisit();
    b.addEventListener('change', () => {
      try { localStorage.setItem(EVERY, b.checked ? '1' : '0'); } catch {}
      for (const other of everyBoxes) other.checked = b.checked;
    });
  }
  let returnFocus = null;

  /**
   * The menu for an intent: the planner, or (accessibility) the note in its place.
   * Exploring starts with the planner folded, so map taps open popups instead of
   * adding trip points (a closed planner ignores them); a shared trip keeps it open.
   */
  function showMenu(intent) {
    const access = intent === 'access';
    planSection.hidden = access;
    accessNote.hidden = !access;
    planDetails.open = intent === 'bike' || (intent === 'explore' && skipWelcome);
    for (const r of radios) r.checked = r.value === intent;
  }

  function choose(intent, { fromWelcome = false } = {}) {
    if (!INTENTS[intent]) return;
    // Picking the same use again on a later visit keeps the layers the person set since.
    const same = recall() === intent;
    remember(intent);
    if (!(same && fromWelcome)) setLayers(INTENTS[intent].layers);
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
      // Closing without a choice keeps the current use (on a first visit: exploring).
      e.stopPropagation();
      closeWelcome();
      if (!recall()) choose('explore', { fromWelcome: true });
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog: the three choices and the checkbox.
      const stops = [...buttons, welcome.querySelector('input[data-welcome-every]')];
      const i = stops.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i + 1) % stops.length;
      e.preventDefault();
      stops[next].focus();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && buttons.includes(document.activeElement)) {
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
  if (!skipWelcome && (!INTENTS[saved] || everyVisit())) openWelcome();
  return { intent: () => recall(), openWelcome };
}
