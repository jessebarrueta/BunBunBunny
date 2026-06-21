import * as THREE from 'three';
import { isFuzzyColor } from '../../core/felt';

type DrawableImage = HTMLCanvasElement | HTMLImageElement | ImageBitmap;
type FeltMaps = {
  readonly fringe: THREE.CanvasTexture;
  readonly normal: THREE.CanvasTexture;
  readonly sheen: THREE.CanvasTexture;
};

const drawableImage = (value: unknown): DrawableImage | undefined => {
  if (value instanceof HTMLCanvasElement || value instanceof HTMLImageElement) return value;
  return value instanceof ImageBitmap ? value : undefined;
};

const textureFromCanvas = (
  canvas: HTMLCanvasElement,
  source: THREE.Texture,
  colorSpace: THREE.ColorSpace,
): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `${source.name}-felt`;
  texture.colorSpace = colorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.channel = source.channel;
  texture.offset.copy(source.offset);
  texture.repeat.copy(source.repeat);
  texture.center.copy(source.center);
  texture.rotation = source.rotation;
  texture.needsUpdate = true;
  return texture;
};

const feltMaps = (
  source: THREE.Texture,
): FeltMaps | undefined => {
  const image = drawableImage(source.image as unknown);
  if (!image) return undefined;
  const scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const sheenCanvas = document.createElement('canvas');
  const normalCanvas = document.createElement('canvas');
  const fringeCanvas = document.createElement('canvas');
  sheenCanvas.width = normalCanvas.width = fringeCanvas.width = width;
  sheenCanvas.height = normalCanvas.height = fringeCanvas.height = height;
  const sheenContext = sheenCanvas.getContext('2d');
  const normalContext = normalCanvas.getContext('2d');
  const fringeContext = fringeCanvas.getContext('2d');
  if (!sheenContext || !normalContext || !fringeContext) return undefined;
  const sheen = sheenContext.createImageData(width, height);
  const normal = normalContext.createImageData(width, height);
  const fringe = fringeContext.createImageData(width, height);

  // ponytail: infer Bunny Boy's mask from hue; authored masks replace this for production skins.
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index] ?? 0;
    const green = pixels.data[index + 1] ?? 0;
    const blue = pixels.data[index + 2] ?? 0;
    const fuzzy = isFuzzyColor(red, green, blue);
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const hash = Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
    const normalX = fuzzy ? 128 + (((hash & 255) - 128) >> 2) : 128;
    const normalY = fuzzy ? 128 + ((((hash >>> 8) & 255) - 128) >> 2) : 128;
    sheen.data[index] = fuzzy ? red : 0;
    sheen.data[index + 1] = fuzzy ? green : 0;
    sheen.data[index + 2] = fuzzy ? blue : 0;
    sheen.data[index + 3] = 255;
    normal.data[index] = normalX;
    normal.data[index + 1] = normalY;
    normal.data[index + 2] = 255;
    normal.data[index + 3] = 255;
    fringe.data[index] = fuzzy ? 255 : 0;
    fringe.data[index + 1] = fuzzy ? 255 : 0;
    fringe.data[index + 2] = fuzzy ? 255 : 0;
    fringe.data[index + 3] = 255;
  }

  sheenContext.putImageData(sheen, 0, 0);
  normalContext.putImageData(normal, 0, 0);
  fringeContext.putImageData(fringe, 0, 0);
  return {
    fringe: textureFromCanvas(fringeCanvas, source, THREE.NoColorSpace),
    normal: textureFromCanvas(normalCanvas, source, THREE.NoColorSpace),
    sheen: textureFromCanvas(sheenCanvas, source, THREE.SRGBColorSpace),
  };
};

const feltMaterial = (
  source: THREE.MeshStandardMaterial,
  maps: FeltMaps | undefined,
): THREE.MeshPhysicalMaterial => {
  const material = new THREE.MeshPhysicalMaterial({
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    color: source.color,
    map: source.map,
    metalness: source.metalness,
    opacity: source.opacity,
    roughness: Math.max(0.96, source.roughness),
    side: source.side,
    transparent: source.transparent,
    vertexColors: source.vertexColors,
  });
  material.name = `${source.name}-felt`;
  if (maps) {
    material.normalMap = maps.normal;
    material.normalScale.set(0.5, 0.5);
    material.sheenColor.set(0xffffff);
    material.sheenColorMap = maps.sheen;
    material.sheenRoughness = 0.88;
  }
  return material;
};

// Felt fuzz is a single expanded skinned pass (spec §3.5: no layered shell fur).
// The hull is pushed a few screen-pixels along the outward normal and rendered
// double-sided, so sparse fiber tips dust the whole pink/blue surface and poke
// past the silhouette to break the hard edge. High-frequency UV-space noise makes
// the fibers; a grazing term makes them denser at the silhouette. Tune by eye:
const FRINGE_WIDTH_PX = 2; // how far the fuzz tips lift off the surface
const FRINGE_WIDTH_JITTER = 0.5; // ragged-edge variation, 0..1 of the width
const FRINGE_UV_SCALE = 220; // fiber density (higher = finer fuzz)
const FRINGE_FIBER_THRESHOLD = new THREE.Vector2(0.35, 0.7); // noise cutoff → fiber sparsity
const FRINGE_STRENGTH = 0.85; // peak fuzz opacity
const FRINGE_BASE = 0.35; // fuzz density on camera-facing surface
const FRINGE_RIM_BOOST = 0.9; // extra fuzz density at the silhouette
const FRINGE_LIFT = 0.125; // how much fiber tips whiten (catch light)

const FRINGE_NOISE_GLSL = `
float fringeHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fringeNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float nx00 = mix(fringeHash(i), fringeHash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float nx10 = mix(fringeHash(i + vec3(0.0, 1.0, 0.0)), fringeHash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float nx01 = mix(fringeHash(i + vec3(0.0, 0.0, 1.0)), fringeHash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float nx11 = mix(fringeHash(i + vec3(0.0, 1.0, 1.0)), fringeHash(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}
float fringeFibers(vec2 uv) {
  vec3 p = vec3(uv, 0.0);
  float f = 0.52 * fringeNoise(p);
  f += 0.30 * fringeNoise(p * 2.3 + 11.0);
  f += 0.18 * fringeNoise(p * 5.1 + 23.0);
  return f;
}
`;

const FRINGE_VERTEX_DECLS = `
uniform float fringePixels;
uniform vec2 fringeViewport;
uniform float fringeWidthJitter;
uniform float fringeUvScale;
varying vec2 vFringeUv;
varying vec3 vFringeNormalView;
varying vec3 vFringeViewDir;
`;

const FRINGE_VERTEX_BODY = `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
vFringeUv = uv;
vFringeNormalView = normalize(transformedNormal);
vFringeViewDir = normalize(-mvPosition.xyz);
vec4 clipPosition = projectionMatrix * mvPosition;
vec2 projectedNormal = (projectionMatrix * vec4(transformedNormal, 0.0)).xy;
vec2 outward = projectedNormal / max(length(projectedNormal), 1e-4);
float fringeJitter = mix(1.0 - fringeWidthJitter, 1.0 + fringeWidthJitter, fringeHash(vec3(uv * fringeUvScale, 0.0)));
clipPosition.xy += outward * (2.0 * fringePixels * fringeJitter / fringeViewport) * clipPosition.w;
gl_Position = clipPosition;`;

const FRINGE_FRAGMENT_DECLS = `
uniform float fringeUvScale;
uniform vec2 fringeThreshold;
uniform float fringeStrength;
uniform float fringeBase;
uniform float fringeRimBoost;
uniform float fringeLift;
varying vec2 vFringeUv;
varying vec3 vFringeNormalView;
varying vec3 vFringeViewDir;
`;

const FRINGE_FRAGMENT_BODY = `#include <alphamap_fragment>
vec3 fringeNormal = normalize(vFringeNormalView);
vec3 fringeView = normalize(vFringeViewDir);
float fringeGraze = 1.0 - abs(dot(fringeNormal, fringeView));
float fringeRaw = fringeFibers(vFringeUv * fringeUvScale);
float fringeFiberAa = fwidth(fringeRaw);
float fringeFiber = smoothstep(fringeThreshold.x - fringeFiberAa, fringeThreshold.y + fringeFiberAa, fringeRaw);
float fringeDensity = clamp(fringeBase + fringeGraze * fringeRimBoost, 0.0, 1.0);
diffuseColor.a *= fringeFiber * fringeDensity * fringeStrength;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), fringeFiber * fringeLift);`;

const fringeMaterial = (
  source: THREE.MeshStandardMaterial,
  mask: THREE.Texture,
  viewport: THREE.Vector2,
): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({
    alphaMap: mask,
    color: source.color,
    depthWrite: false,
    map: source.map,
    side: THREE.DoubleSide,
    transparent: true,
  });
  material.name = `${source.name}-felt-fringe`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fringePixels = { value: FRINGE_WIDTH_PX };
    shader.uniforms.fringeViewport = { value: viewport };
    shader.uniforms.fringeWidthJitter = { value: FRINGE_WIDTH_JITTER };
    shader.uniforms.fringeUvScale = { value: FRINGE_UV_SCALE };
    shader.uniforms.fringeThreshold = { value: FRINGE_FIBER_THRESHOLD };
    shader.uniforms.fringeStrength = { value: FRINGE_STRENGTH };
    shader.uniforms.fringeBase = { value: FRINGE_BASE };
    shader.uniforms.fringeRimBoost = { value: FRINGE_RIM_BOOST };
    shader.uniforms.fringeLift = { value: FRINGE_LIFT };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${FRINGE_VERTEX_DECLS}${FRINGE_NOISE_GLSL}\nvoid main() {`)
      .replace('#include <project_vertex>', FRINGE_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRINGE_FRAGMENT_DECLS}${FRINGE_NOISE_GLSL}\nvoid main() {`)
      .replace('#include <alphamap_fragment>', FRINGE_FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => 'felt-fringe-v4';
  return material;
};

const fringeMesh = (
  source: THREE.SkinnedMesh,
  material: THREE.Material | THREE.Material[],
): THREE.SkinnedMesh => {
  const fringe = new THREE.SkinnedMesh(source.geometry, material);
  fringe.name = `${source.name}-felt-fringe`;
  fringe.position.copy(source.position);
  fringe.quaternion.copy(source.quaternion);
  fringe.scale.copy(source.scale);
  fringe.bindMode = source.bindMode;
  fringe.bind(source.skeleton, source.bindMatrix);
  fringe.frustumCulled = source.frustumCulled;
  return fringe;
};

export const applyFeltMaterial = (root: THREE.Object3D, viewport: THREE.Vector2): void => {
  const fringes: Array<readonly [THREE.Object3D, THREE.SkinnedMesh]> = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const maps = materials.map((material) =>
      material instanceof THREE.MeshStandardMaterial && material.map
        ? feltMaps(material.map)
        : undefined,
    );
    const felt = materials.map((material, index) =>
      material instanceof THREE.MeshStandardMaterial ? feltMaterial(material, maps[index]) : material,
    );
    const fringe = materials.map((material, index) => {
      const map = maps[index];
      return material instanceof THREE.MeshStandardMaterial && map
        ? fringeMaterial(material, map.fringe, viewport)
        : new THREE.MeshBasicMaterial({ visible: false });
    });
    object.material = Array.isArray(object.material) ? felt : felt[0];
    const parent = object.parent;
    const fringeMaterialValue = Array.isArray(object.material) ? fringe : fringe[0];
    if (parent && fringeMaterialValue) {
      fringes.push([parent, fringeMesh(object, fringeMaterialValue)]);
    }
  });
  fringes.forEach(([parent, fringe]) => parent.add(fringe));
};
