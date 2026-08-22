import { createRouter, createWebHashHistory } from 'vue-router'
import AboutPage from './pages/AboutPage.vue'
import DataPage from './pages/DataPage.vue'
import DiagnosticsPage from './pages/DiagnosticsPage.vue'
import GeneralPage from './pages/GeneralPage.vue'
import ShortcutsPage from './pages/ShortcutsPage.vue'
import SitesPage from './pages/SitesPage.vue'

export function createOptionsRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', redirect: '/general' },
      { path: '/general', name: 'general', component: GeneralPage },
      { path: '/shortcuts', name: 'shortcuts', component: ShortcutsPage },
      { path: '/sites', name: 'sites', component: SitesPage },
      { path: '/data', name: 'data', component: DataPage },
      { path: '/diagnostics', name: 'diagnostics', component: DiagnosticsPage },
      { path: '/about', name: 'about', component: AboutPage }
    ]
  })
}
