// Developer screen-jump panel: only with ?dev=1 in the address. A small DEV button (top left) opens
// a panel to jump straight to any screen: the title, the start of the game, any level's journey or
// battle, a meteor field, victory or game over, and to replay or skip the tutorial. Players never
// see it.
//
// api: { levels: [{ label }], title(), victory(), gameOver(), level(n, phase: 'journey' | 'battle' |
//        'meteors'), meteorLevel(n) -> the level whose meteor field follows n (or -1), tutorial(on) }

export const devMode = () => new URLSearchParams(location.search).get('dev') === '1';

export function setupDevPanel(api) {
  const root = document.createElement('div');
  root.id = 'devpanel';
  root.className = 'dev';
  const options = api.levels.map((l, i) => `<option value="${i}">${l.label}</option>`).join('');
  root.innerHTML = `
    <button class="dev-toggle" type="button" aria-expanded="false">DEV</button>
    <div class="dev-body" hidden>
      <div class="dev-row"><span>Screen</span>
        <button type="button" data-go="title">Title</button>
        <button type="button" data-go="start">Start</button>
        <button type="button" data-go="victory">Victory</button>
        <button type="button" data-go="gameover">Game over</button>
      </div>
      <div class="dev-row"><span>Level</span>
        <select class="dev-level" aria-label="Level">${options}</select>
        <button type="button" data-go="journey">Journey</button>
        <button type="button" data-go="battle">Battle</button>
        <button type="button" data-go="meteors">Meteors</button>
      </div>
      <div class="dev-row"><span>Tutorial</span>
        <button type="button" data-go="tut-on">Replay</button>
        <button type="button" data-go="tut-off">Skip</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.dev-body');
  const toggle = root.querySelector('.dev-toggle');
  const level = root.querySelector('.dev-level');
  const meteors = root.querySelector('[data-go="meteors"]');
  const syncMeteors = () => { meteors.disabled = api.meteorLevel(+level.value) < 0; };
  level.addEventListener('change', syncMeteors);
  syncMeteors();

  // keep clicks and keys in the panel away from the game
  for (const ev of ['pointerdown', 'pointerup', 'click', 'keydown']) root.addEventListener(ev, (e) => e.stopPropagation());
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
  });
  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]')?.dataset.go;
    if (!go) return;
    const n = +level.value;
    if (go === 'title') api.title();
    else if (go === 'start') api.level(0, 'journey');
    else if (go === 'victory') api.victory();
    else if (go === 'gameover') api.gameOver();
    else if (go === 'journey' || go === 'battle') api.level(n, go);
    else if (go === 'meteors') api.level(api.meteorLevel(n), 'meteors');
    else if (go === 'tut-on') api.tutorial(true);
    else if (go === 'tut-off') api.tutorial(false);
  });
}
