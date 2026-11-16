import { ZONES, BET_STEPS, START_BALANCE, draw, tierOf } from './paytable.js';

const STORE_KEY = 'extraction.wallet.v1';

// Only the chosen bet size is remembered between visits. The chips are not:
// every time the game is opened the balance starts again from START_BALANCE.
function loadBetIndex() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && BET_STEPS[raw.betIndex]) return raw.betIndex;
  } catch { /* storage unavailable: use the default bet */ }
  return 3;
}

/** Money and round bookkeeping. Knows nothing about rendering. */
export function createGame(targetIds) {
  const state = {
    balance: START_BALANCE,
    betIndex: loadBetIndex(),
    busy: false,
    round: 1,
    results: new Map(), // targetId -> { mult, win, bet, tier }
    history: [], // most recent first
    wagered: 0,
    won: 0,
    lastWin: 0,
  };
  const listeners = new Set();
  const changed = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ betIndex: state.betIndex })); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(state));
  };

  const game = {
    state,
    onChange(fn) { listeners.add(fn); fn(state); },
    get bet() { return BET_STEPS[state.betIndex]; },
    get remaining() { return targetIds.length - state.results.size; },

    changeBet(dir) {
      const i = Math.max(0, Math.min(BET_STEPS.length - 1, state.betIndex + dir));
      if (i === state.betIndex) return false;
      state.betIndex = i;
      changed();
      return true;
    },

    /** 'ok' or the reason the target cannot be played right now. */
    check(id) {
      if (state.busy) return 'busy';
      if (state.results.has(id)) return 'gone';
      if (state.balance < game.bet) return 'funds';
      return 'ok';
    },

    /** Take the stake and decide the result. `force` is for testing only. */
    place(id, zone, force) {
      const bet = game.bet;
      state.balance -= bet;
      state.wagered += bet;
      state.busy = true;
      const mult = force !== undefined ? force : draw(zone);
      const outcome = { id, zone, bet, mult, win: Math.round(bet * mult * 100) / 100, tier: tierOf(mult) };
      state.results.set(id, outcome);
      changed();
      return outcome;
    },

    /** Pay out (called at the moment the result is revealed on screen). */
    settle(outcome) {
      state.balance = Math.round((state.balance + outcome.win) * 100) / 100;
      outcome.shown = true;
      state.won += outcome.win;
      state.lastWin = outcome.win;
      state.history.unshift(outcome);
      if (state.history.length > 12) state.history.pop();
      changed();
    },

    setBusy(b) { state.busy = b; changed(); },

    newRound() {
      state.results.clear();
      state.round += 1;
      state.wagered = 0; state.won = 0; state.lastWin = 0;
      changed();
    },

    refill() {
      state.balance = START_BALANCE;
      changed();
    },
  };
  return game;
}

export { ZONES, BET_STEPS };
