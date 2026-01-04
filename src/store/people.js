import mergeOne from '@/util/mergeOne'
import managed from '@/store/modules/managed'
import filterable from '@/store/modules/filterable'
import shuffleable from '@/store/modules/shuffleable'

const moduleFilterable = filterable()
const module = mergeOne(managed('people'), moduleFilterable, shuffleable(), {
  getters: {
    // override filterable getters.filtered to filter shuffled
    filtered: (state, getters, rootState) =>
      moduleFilterable.getters.filtered(state)(state.shuffled, 'identities'),
  },
})

export default module
