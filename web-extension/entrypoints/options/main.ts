import { createApp } from 'vue'
import { OptionsApplication } from '../../src/application/ui'
import {
  WxtActiveTabPort,
  WxtRuntimeTransport,
  WxtSettingsChangeSourcePort
} from '../../src/infrastructure/browser/wxt-browser-ports'
import { RuntimeApiClient } from '../../src/infrastructure/messaging/runtime-api-client'
import { RuntimeRequestClient } from '../../src/infrastructure/messaging/request-client'
import { systemScheduler } from '../../src/infrastructure/time/system-time'
import OptionsApp from '../../src/ui/options/OptionsApp.vue'
import { createOptionsRouter } from '../../src/ui/options/router'
import '../../src/ui/styles/tokens.css'

const api = new RuntimeApiClient(
  new RuntimeRequestClient('options', new WxtRuntimeTransport(), systemScheduler)
)

const application = new OptionsApplication(
  api,
  new WxtActiveTabPort(),
  new WxtSettingsChangeSourcePort()
)

createApp(OptionsApp, { application }).use(createOptionsRouter()).mount('#app')
