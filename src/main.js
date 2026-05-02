import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

import {createApp} from 'vue'
import {createVuetify} from 'vuetify'
import * as vertical from 'vuetify/labs/VStepperVertical'

import './assets/td.css'
import './main.css'
import App from './App.vue'

const vuetify = createVuetify({
    components: {...vertical},
    theme: {
        defaultTheme: 'titanDark',
        themes: {
            titanDark: {
                dark: true,
                colors: {
                    background: '#0A0B0D',
                    surface: '#15171A',
                    'surface-variant': '#1D2024',
                    primary: '#F26B1F',
                    secondary: '#C9551A',
                    info: '#5B9DF6',
                    success: '#4FC78F',
                    warning: '#E5A53B',
                    error: '#E8624C'
                }
            }
        }
    },
    defaults: {
        global: {
            density: "compact",
        },
        VBtn: {
            density: "default",
            color: "primary"
        },
        VSelect: {
            variant: "outlined"
        },
        VAutocomplete: {
            variant: "outlined"
        },
        VTextField: {
            variant: "outlined"
        },
        VTextarea: {
            variant: "outlined"
        }
    }
})

createApp(App)
    .use(vuetify)
    .mount('#app')
