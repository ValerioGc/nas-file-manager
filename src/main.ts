import { guardFrame } from '@valeriogc/nas-base-app';
import { createApp } from 'vue';
import App from '@/App.vue';
import { loadFavorites } from '@/composables/useFavorites';
import { loadPreferences } from '@/composables/usePreferences';
import { loadShares } from '@/composables/useShares';
import '@/styles/main.scss';

// In the frame of the launcher, the rules its sandbox used to apply, before anything else runs.
guardFrame();

// The settings, the favorites and the shared folders the backend keeps, for every browser.
void loadPreferences();
void loadFavorites();
void loadShares();

createApp(App).mount('#app');
