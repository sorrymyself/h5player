import { createApp } from 'vue'
import { PopupApplication } from '../../src/application/ui'
import {
  WxtActiveTabPort,
  WxtRuntimeTransport
} from '../../src/infrastructure/browser/wxt-browser-ports'
import { RuntimeApiClient } from '../../src/infrastructure/messaging/runtime-api-client'
import { RuntimeRequestClient } from '../../src/infrastructure/messaging/request-client'
import { systemScheduler } from '../../src/infrastructure/time/system-time'
import PopupApp from '../../src/ui/popup/PopupApp.vue'
import '../../src/ui/styles/tokens.css'

const api = new RuntimeApiClient(
  new RuntimeRequestClient('popup', new WxtRuntimeTransport(), systemScheduler)
)

createApp(PopupApp, { application: new PopupApplication(api, new WxtActiveTabPort()) }).mount(
  '#app'
)
