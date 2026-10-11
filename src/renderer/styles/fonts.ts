// The brand's typefaces (FONTS in lib/brand.ts), bundled so the app looks the
// same on every machine instead of falling back to whatever monospace font is
// installed. SIL Open Font License. Variable fonts: one woff2 per character
// set covers every weight, about 200 KB in all. Every character set ships,
// not just Latin, so names with accents or in Cyrillic or Greek stay in the
// same face; the browser only loads a set when the page uses its characters.
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import '@fontsource-variable/pixelify-sans/wght.css';
