import uid from '@/util/chronouid'
import mergeOne from '@/util/mergeOne'
import managed from '@/store/modules/managed'
import sortable from '@/store/modules/sortable'

const managedModule = {
  books: managed('tags/books'),
  people: managed('tags/people'),
  bundles: managed('tags/bundles'),
}

/** A module mixin that provides some overrides that are specific to tag collections. */
const tagModule = {
  actions: {
    /** Deletes a tag, removes it from all books, and logs. */
    async remove(ctx, path) {
      const tag = ctx.state.data?.[path]
      const type = ctx.state.name.replace('tags/', '')
      const tagProp = type === 'people' ? 'identities' : 'tags'
      let items = null
      let errorMessage = ''

      if (!tag) {
        console.error(`No tag at "${path}"`)
        return
      }

      // remove tag from items first, so that if it fails, it can be retried
      // if the tag was deleted first, then a retry wouldn't be possible
      try {
        // get items
        items = ctx.rootGetters[`${type}/list`]().filter(item => item[tagProp]?.[tag.id])

        // remove tag from items
        await Promise.all(
          items.map(item =>
            ctx.dispatch(
              `${type}/update`,
              {
                path: `${item.id}/${tagProp}`,
                value: {
                  [tag.id]: null,
                },
              },
              { root: true },
            ),
          ),
        )

        // delete tag
        await managedModule[type].actions.remove(ctx, path)
      } catch (e) {
        errorMessage = e.message
      } finally {
        // only add to audit log if there was an error or the tag actually had books to avoid noisy logs
        if (!items || items.length > 0) {
          // make the items more readable by only including id and name/title
          const itemsObject = items
            ? items.reduce(
                (accum, item) => ({
                  [item.id]: item.title || item.name,
                }),
                {},
              )
            : null
          const removedFromItemsMessage = items
            ? `Removed from ${items.length} ${type}:\n${JSON.stringify(itemsObject, null, 2)}`
            : `Error removing tag from items: ${errorMessage}`
          const message = `Deleted tag "${tag.tag}":\n${JSON.stringify(
            tag,
            null,
            2,
          )}\n\n${removedFromItemsMessage}`
          await ctx.dispatch(
            `logs/save`,
            {
              path: uid(),
              value: {
                createdAt: new Date().toISOString(),
                type: 'tags',
                action: 'delete',
                message: message,
              },
            },
            { root: true },
          )
        }
      }
    },
  },
}

const module = {
  namespaced: true,
  modules: {
    books: mergeOne(managedModule.books, sortable(), tagModule),
    people: mergeOne(managedModule.people, sortable(), tagModule),
    bundles: mergeOne(managedModule.bundles, sortable(), tagModule),
  },
  actions: {
    async subscribe({ dispatch, commit }, options = {}) {
      dispatch('books/subscribe', options.books)
      dispatch('bundles/subscribe', options.bundles)
      dispatch('people/subscribe', options.people)
    },
  },
  getters: {
    /**
     * Gets a sorted list of standalone top level tags with no subtags.
     *
     * @param type    books | people | bundles
     * */
    topLevel: (state, getters, rootState, rootGetters) => type => {
      const allTags = rootGetters[`tags/${type}/listSorted`]()
      const subTags = allTags.filter(tag => tag.parent)
      return allTags.filter(
        tag =>
          // top level
          !tag.parent &&
          // does not have any subtags
          !subTags.some(subtag => subtag.parent === tag.id),
      )
    },

    /** Gets a sorted list of all subtags of a parent tag. */
    subtags: (state, getters, rootState, rootGetters) => (type, parentTagName) => {
      const allTags = rootGetters[`tags/${type}/listSorted`]()
      const parent = allTags.find(tag => tag.tag === parentTagName)
      return allTags.filter(subtag => subtag.parent === parent.id)
    },
  },
}

export default module
