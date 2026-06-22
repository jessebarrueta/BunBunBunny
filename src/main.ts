import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { easeInOutCubic } from './core/animation';
import { isSwipeUp } from './core/gesture';
import { applyFeltMaterial } from './shell/render/felt-material';

type ClipName = 'happy_idle' | 'idle' | 'leap' | 'wave';
type Placement = 'center' | 'feed' | 'leap';

const FEED_YAW = Math.PI / 5;
const LEAP_YAW = FEED_YAW + Math.PI / 2;
const TURN_DURATION_SECONDS = 0.32;
const SIZE_DURATION_SECONDS = 0.65;
const FEED_SIZE = 0.34;
const PLAY_SIZE = 0.5;
const FADE_START_PROGRESS = 0.78;
const WAVE_INTERVAL_MS = 60_000;
const JAW_TEST_CYCLE_SECONDS = 1;
const JAW_TEST_CLOSED_ROTATION = THREE.MathUtils.degToRad(-40);
// GLTFLoader removes reserved colons from runtime node names.
const JAW_BONE_NAME = 'mixamorigJaw';
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const jawTestRotation = new THREE.Quaternion();
const jawRestRotation = new THREE.Quaternion();
const centerOffset = new THREE.Vector3();
const rootOffset = new THREE.Vector3();
const fringeViewport = new THREE.Vector2(1, 1);
const cards = [...document.querySelectorAll<HTMLElement>('.game-card')];
const feed = document.querySelector<HTMLElement>('.feed');
const loading = document.querySelector<HTMLElement>('.loading');
const companion = document.querySelector<HTMLElement>('.companion');
const companionStage = document.querySelector<HTMLElement>('.companion__stage');
const closeButton = document.querySelector<HTMLButtonElement>('.game-close');
const handoffFade = document.querySelector<HTMLElement>('.handoff-fade');
const bottomNav = document.querySelector<HTMLElement>('.bottom-nav');
const initialCard = cards[0];

if (
  !feed ||
  !loading ||
  !companion ||
  !companionStage ||
  !closeButton ||
  !handoffFade ||
  !initialCard
) {
  throw new Error('Feed markup is incomplete');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0, 5.2);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.className = 'character-canvas';
renderer.domElement.setAttribute('aria-label', 'Bunny Boy character');

scene.add(new THREE.HemisphereLight(0xfff0df, 0x4b3762, 2.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

let focusedCard = initialCard;
let playingCard: HTMLElement | undefined;
let mixer: THREE.AnimationMixer | undefined;
let character: THREE.Group | undefined;
let jawBone: THREE.Bone | undefined;
let characterCenter = new THREE.Vector3();
let characterBaseScale = 1;
let characterWidth = 1;
let characterHeight = 1;
let leapDuration = 1;
let leapRootDelta = new THREE.Vector3();
let clips: ReadonlyMap<string, THREE.AnimationClip> = new Map();
let activeAction: THREE.AnimationAction | undefined;
let pointerStartY = 0;
let turnStartedAt: number | undefined;
let sizeStartedAt: number | undefined;
let sizeFrom = FEED_SIZE;
let sizeTarget = FEED_SIZE;
let displaySize = FEED_SIZE;
let placement: Placement = 'feed';
let leapStartedAt: number | undefined;
let fadeStarted = false;
let handoffId = 0;
let waveTimer: number | undefined;

// ponytail: temporary rig smoke test; replace with gameplay-driven mouth poses.
const jawTestAngle = (elapsedSeconds: number): number =>
  JAW_TEST_CLOSED_ROTATION *
  (1 - Math.cos((elapsedSeconds / JAW_TEST_CYCLE_SECONDS) * Math.PI * 2)) / 2;

const resize = (): void => {
  const { clientWidth, clientHeight } = renderer.domElement;
  if (clientWidth === 0 || clientHeight === 0) return;
  renderer.setSize(clientWidth, clientHeight, false);
  fringeViewport.set(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
};

const sizeTo = (target: number): void => {
  sizeStartedAt = timer.getElapsed();
  sizeFrom = displaySize;
  sizeTarget = target;
};

const layoutCharacter = (): void => {
  if (!character) return;
  const verticalSpan = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const horizontalSpan = verticalSpan * camera.aspect;
  const scale = characterBaseScale * displaySize;
  const feedCenterX = -horizontalSpan / 2 + (characterWidth * displaySize) / 2 + horizontalSpan * 0.01;
  // Lift the resting companion clear of the bottom nav (canvas is full-viewport).
  const worldPerPixel = verticalSpan / Math.max(1, renderer.domElement.clientHeight);
  const navInset = (bottomNav?.offsetHeight ?? 0) * worldPerPixel;
  const feedCenterY =
    -verticalSpan / 2 + (characterHeight * displaySize) / 2 + verticalSpan * 0.025 + navInset;
  const leapProgress = leapStartedAt === undefined
    ? 0
    : Math.min(1, (timer.getElapsed() - leapStartedAt) / leapDuration);
  rootOffset
    .copy(leapRootDelta)
    .applyAxisAngle(Y_AXIS, LEAP_YAW)
    .multiplyScalar(characterBaseScale * PLAY_SIZE);
  const centerX = placement === 'center'
    ? 0
    : placement === 'leap'
      ? THREE.MathUtils.lerp(feedCenterX, -rootOffset.x, easeInOutCubic(leapProgress))
      : feedCenterX;
  const centerY = placement === 'center'
    ? 0
    : placement === 'leap'
      ? THREE.MathUtils.lerp(feedCenterY, -rootOffset.y, easeInOutCubic(leapProgress))
      : feedCenterY;
  centerOffset.copy(characterCenter).applyAxisAngle(Y_AXIS, character.rotation.y).multiplyScalar(scale);
  character.scale.setScalar(scale);
  character.position.set(centerX - centerOffset.x, centerY - centerOffset.y, -centerOffset.z);
};

const beginLandingFade = (): void => {
  if (fadeStarted) return;
  fadeStarted = true;
  const currentHandoff = ++handoffId;
  handoffFade.classList.add('is-covering');
  handoffFade.addEventListener(
    'transitionend',
    () => {
      if (currentHandoff !== handoffId || !playingCard) return;
      placement = 'center';
      leapStartedAt = undefined;
      if (character) character.rotation.y = FEED_YAW;
      play('idle');
      window.setTimeout(() => {
        if (currentHandoff === handoffId) handoffFade.classList.remove('is-covering');
      }, 80);
    },
    { once: true },
  );
};

const play = (name: ClipName, loop = true): void => {
  const clip = clips.get(name);
  if (!mixer || !clip) return;
  const next = mixer.clipAction(clip);
  next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  activeAction?.fadeOut(0.12);
  next.fadeIn(0.12).play();
  activeAction = next;
};

const stopWaveTimer = (): void => {
  if (waveTimer === undefined) return;
  window.clearTimeout(waveTimer);
  waveTimer = undefined;
};

const scheduleWave = (): void => {
  stopWaveTimer();
  waveTimer = window.setTimeout(() => {
    waveTimer = undefined;
    if (!playingCard && placement === 'feed') play('wave', false);
    scheduleWave();
  }, WAVE_INTERVAL_MS);
};

const focus = (card: HTMLElement): void => {
  if (playingCard || card === focusedCard) return;
  focusedCard.classList.remove('is-focused');
  focusedCard = card;
  focusedCard.classList.add('is-focused');
  play(card.dataset.reaction === 'excited' ? 'happy_idle' : 'idle', false);
};

const cardNearestCenter = (): HTMLElement =>
  cards.reduce((nearest, card) => {
    const viewportCenter = window.innerHeight / 2;
    const cardCenter = card.getBoundingClientRect().top + card.clientHeight / 2;
    const nearestCenter = nearest.getBoundingClientRect().top + nearest.clientHeight / 2;
    return Math.abs(cardCenter - viewportCenter) < Math.abs(nearestCenter - viewportCenter)
      ? card
      : nearest;
  }, focusedCard);

const startLeap = (): void => {
  const card = playingCard;
  if (!card) return;
  turnStartedAt = undefined;
  placement = 'leap';
  leapStartedAt = timer.getElapsed();
  fadeStarted = false;
  play('leap', false);
  card.classList.add('is-playing');
  companion.classList.add('is-playing');
  feed.classList.add('has-active-game');
  closeButton.hidden = false;
  sizeTo(PLAY_SIZE);
  resize();
};

const enter = (card: HTMLElement): void => {
  if (playingCard || card !== focusedCard || !character) return;
  stopWaveTimer();
  play('idle');
  playingCard = card;
  turnStartedAt = timer.getElapsed();
};

const exit = (returnToSelected = false): void => {
  const card = playingCard;
  if (!card) return;
  const commit = (): void => {
    card.classList.remove('is-playing');
    companion.classList.remove('is-playing');
    feed.classList.remove('has-active-game');
    closeButton.hidden = true;
    playingCard = undefined;
    if (returnToSelected) {
      card.scrollIntoView({ block: 'center' });
      focus(card);
    } else {
      focus(cardNearestCenter());
    }
    resize();
  };
  commit();
  handoffId += 1;
  handoffFade.classList.remove('is-covering');
  turnStartedAt = undefined;
  leapStartedAt = undefined;
  fadeStarted = false;
  placement = 'feed';
  sizeTo(FEED_SIZE);
  if (character) character.rotation.y = FEED_YAW;
  play('idle');
  scheduleWave();
};

const observer = new IntersectionObserver(
  (entries) => {
    const centered = entries.find((entry) => entry.isIntersecting);
    if (centered?.target instanceof HTMLElement) focus(centered.target);
  },
  { root: feed, threshold: 0.72 },
);

cards.forEach((card) => {
  observer.observe(card);
  card.addEventListener('click', () => enter(card));
});
closeButton.addEventListener('click', () => exit(true));

window.addEventListener('pointerdown', (event) => {
  pointerStartY = event.clientY;
});
window.addEventListener('pointerup', (event) => {
  if (playingCard && isSwipeUp(pointerStartY, event.clientY)) exit();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') exit(true);
});
window.addEventListener('resize', resize);
feed.addEventListener('scrollend', () => focus(cardNearestCenter()));

focusedCard.classList.add('is-focused');
companionStage.append(renderer.domElement);

const timer = new THREE.Timer();
timer.connect(document);
const render = (): void => {
  timer.update();
  const delta = timer.getDelta();
  const elapsed = timer.getElapsed();
  mixer?.update(delta);
  if (jawBone) {
    jawTestRotation.setFromAxisAngle(X_AXIS, jawTestAngle(elapsed));
    jawBone.quaternion.copy(jawRestRotation).multiply(jawTestRotation);
  }
  if (sizeStartedAt !== undefined) {
    const progress = (elapsed - sizeStartedAt) / SIZE_DURATION_SECONDS;
    displaySize = THREE.MathUtils.lerp(sizeFrom, sizeTarget, easeInOutCubic(progress));
    if (progress >= 1) sizeStartedAt = undefined;
  }
  if (character && turnStartedAt !== undefined) {
    const progress = (elapsed - turnStartedAt) / TURN_DURATION_SECONDS;
    character.rotation.y = THREE.MathUtils.lerp(FEED_YAW, LEAP_YAW, easeInOutCubic(progress));
    if (progress >= 1) startLeap();
  }
  if (
    placement === 'leap' &&
    leapStartedAt !== undefined &&
    (elapsed - leapStartedAt) / leapDuration >= FADE_START_PROGRESS
  ) {
    beginLandingFade();
  }
  resize();
  layoutCharacter();
  renderer.render(scene, camera);
};
renderer.setAnimationLoop(render);

const modelUrl = new URL('../assets/bunnyboy-rigged.glb', import.meta.url).href;
new GLTFLoader().load(
  modelUrl,
  (gltf) => {
    applyFeltMaterial(gltf.scene, fringeViewport);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    characterCenter = bounds.getCenter(new THREE.Vector3());
    characterBaseScale = 2.6 / size.y;
    characterWidth = Math.max(size.x, size.z) * characterBaseScale;
    characterHeight = size.y * characterBaseScale;
    gltf.scene.rotation.y = FEED_YAW;
    character = gltf.scene;
    const loadedJaw = gltf.scene.getObjectByName(JAW_BONE_NAME);
    if (loadedJaw instanceof THREE.Bone) {
      jawBone = loadedJaw;
      jawRestRotation.copy(loadedJaw.quaternion);
    } else {
      console.warn(`${JAW_BONE_NAME} was not found in the character rig.`);
    }
    scene.add(gltf.scene);
    mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.addEventListener('finished', () => {
      if (placement !== 'leap') play('idle');
    });
    clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
    const leapClip = clips.get('leap');
    const rootTrack = leapClip?.tracks.find((track) => track.name.endsWith('.position'));
    if (leapClip && rootTrack && rootTrack.values.length >= 6) {
      const values = rootTrack.values;
      leapDuration = leapClip.duration;
      leapRootDelta = new THREE.Vector3(
        (values.at(-3) ?? 0) - (values.at(0) ?? 0),
        (values.at(-2) ?? 0) - (values.at(1) ?? 0),
        (values.at(-1) ?? 0) - (values.at(2) ?? 0),
      );
    }
    play('wave', false);
    scheduleWave();
    loading.hidden = true;
    resize();
  },
  undefined,
  (error) => {
    loading.textContent = 'Bunny Boy could not be loaded.';
    console.error(error);
  },
);
