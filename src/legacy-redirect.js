import {studioTabURL} from './studio-route.js';
const tab=location.pathname.endsWith('/metrics.html')?'metrics':'monitor';
location.replace(studioTabURL(location.href,tab));
