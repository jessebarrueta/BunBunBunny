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

const fringeMaterial = (
  source: THREE.MeshStandardMaterial,
  mask: THREE.Texture,
  viewport: THREE.Vector2,
): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({
    alphaHash: true,
    alphaMap: mask,
    color: source.color,
    depthWrite: false,
    map: source.map,
    opacity: 0.42,
    side: THREE.BackSide,
  });
  material.name = `${source.name}-felt-fringe`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fringePixels = { value: 1.5 };
    shader.uniforms.fringeViewport = { value: viewport };
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `uniform float fringePixels;
uniform vec2 fringeViewport;

void main() {`,
      )
      .replace(
        '#include <project_vertex>',
        `float fringeNoise = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
float fringeWidth = fringePixels * mix(0.55, 1.0, fringeNoise);
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
vec4 clipPosition = projectionMatrix * mvPosition;
vec2 projectedNormal = (projectionMatrix * vec4(transformedNormal, 0.0)).xy;
vec2 fringeDirection = -projectedNormal / max(length(projectedNormal), 0.0001);
clipPosition.xy += fringeDirection * (2.0 * fringeWidth / fringeViewport) * clipPosition.w;
gl_Position = clipPosition;`,
      );
  };
  material.customProgramCacheKey = () => 'felt-fringe-v1';
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
