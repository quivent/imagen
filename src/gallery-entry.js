import {mountArchiveGallery} from './archive-gallery.js';
const gallery=mountArchiveGallery({root:document.getElementById('gallery-root'),defaultCollection:'all'});gallery.setActive(true);
if(import.meta.hot)import.meta.hot.dispose(()=>gallery.destroy());
