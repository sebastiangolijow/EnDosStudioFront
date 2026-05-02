import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// Inter font (loaded by Vite — bundled, not a network request at runtime).
// Weights match the design pack §2.2 typography scale: 400 body, 500 medium,
// 600 semibold (buttons/labels), 700 bold (display + headings).
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'

import './styles/globals.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
