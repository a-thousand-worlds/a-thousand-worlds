import { render as vueRender } from '@testing-library/vue'
import store from '@/store'
import mixins from '@/mixins/global'
import directives from '@/directives'

/** Renders a component with global directives, mixins, and store for tests. */
export const render = component =>
  vueRender(component, {
    // https://vue-test-utils.vuejs.org/v2/api/#mount
    global: {
      directives: {
        ...directives,
        tippy: () => {},
      },
      mixins: [mixins],
      plugins: [store],
    },
  })
