import { guardFrame } from '@valeriogc/nas-base-app';
import { createApp } from 'vue';
import App from '@/App.vue';
import { loadFavorites } from '@/composables/useFavorites';
import { loadPreferences } from '@/composables/usePreferences';
import { loadShares } from '@/composables/useShares';
import '@/styles/main.scss';

guardFrame();

void loadPreferences();
void loadFavorites();
void loadShares();

createApp(App).mount('#app');
