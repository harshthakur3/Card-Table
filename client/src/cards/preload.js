import { allCardImageUrls } from './cardImages.js';

let started = false;
const failed = new Set();
const keep = [];

/** Warm the browser cache with every card face so dealing doesn't flicker. */
export function preloadCardImages() {
  if (started) return;
  started = true;
  for (const url of allCardImageUrls()) {
    const img = new Image();
    img.decoding = 'async';
    img.onerror = () => failed.add(url);
    img.src = url;
    keep.push(img);
  }
}

export function markImageFailed(url) {
  failed.add(url);
}

export function imageFailed(url) {
  return failed.has(url);
}
