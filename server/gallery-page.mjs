export function galleryPageRequest(value){const url=new URL(value,'http://localhost');return ['/gallery','/gallery/'].includes(url.pathname)?'/gallery.html'+url.search:null;}
export function installGalleryPage(server){server.middlewares.use((req,res,next)=>{const page=galleryPageRequest(req.url);if(page)req.url=page;next();});}
