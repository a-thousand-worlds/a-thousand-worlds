<script>
import uid from '@/util/chronouid'
import draggable from 'vuedraggable'
import specialFilters from '@/store/constants/special-filters'

// Sets the cursor while dragging (most of the time)
// See: https://github.com/SortableJS/Vue.Draggable/issues/815#issuecomment-808420144
const setDragCursor = value => {
  const html = document.getElementsByTagName('html').item(0)
  html.classList.toggle('grabbing', value)
}

export default {
  name: 'TagsTable',
  components: {
    draggable,
  },
  props: {
    type: {
      type: String,
      default: 'books',
      required: true,
    },
  },
  data() {
    return {
      dragging: null,
      dragTo: null,
      edits: {},
      newTag: {},
    }
  },
  computed: {
    // returns the id of the last top level tag in the list which serves as the initial parent of a newly created subtag
    defaultSubtagParent() {
      if (!this.tags) return null
      const topLevelTags = this.tags.filter(tag => !tag.parent)
      if (topLevelTags.length === 0) return null
      return topLevelTags[topLevelTags.length - 1].id
    },
    specialFilters() {
      return specialFilters[this.type]
    },
    tags() {
      return this.$store.getters[`tags/${this.type}/listSorted`]()
    },
  },
  watch: {
    type(next) {
      this.resetNewTag()
    },
  },
  created() {
    this.resetNewTag()
  },
  methods: {
    async addTag() {
      const id = uid()
      await this.$store.dispatch(`tags/${this.type}/save`, {
        path: id,
        value: { id, ...this.newTag },
      })
      this.resetNewTag()
    },

    /** On move, set this.dragTo for conditional styles. */
    dragMove(e) {
      const tagNew = this.tags[e.relatedContext.index + (e.willInsertAfter ? 1 : 0)]
      this.dragTo = tagNew
    },

    dragStart(e) {
      const tag = this.tags[e.oldIndex]
      this.dragging = tag
      setDragCursor(true)
    },

    /**
     * Handles completion of a drag with support for subtags.
     *
     * Test cases:
     *
     * Move up/down
     * Move multiple steps up/down
     * Move to top/bottom
     *
     * Move parent up/down
     * Move parent multiple steps up/down
     * Move parent to top/bottom
     *
     * Move subtag up/down
     * Move subtag multiple steps up/down
     * Move subtag to top/bottom
     *
     * Move subtag to another parent
     * Move subtag to top (noop)
     * Move subtag multiple steps up/down
     *
     * Move tag across and above subtags
     * Move tag across and below subtags
     * Move tag between subtags
     *
     */
    async dragEnd(e) {
      this.dragging = null
      this.dragTo = null
      setDragCursor(false)

      const tagOld = this.tags[e.oldIndex]
      const tagNew = this.tags[e.newIndex]
      const tagPrev = this.tags[e.newIndex - 1]
      const tagNext = this.tags[e.newIndex + 1]

      if (!tagOld || !tagNew) {
        throw new Error('Tag index error')
      }

      if (e.oldIndex === e.newIndex) return

      const moveDown = tagOld.sortOrder < tagNew.sortOrder
      const parentOld = this.getParent(tagOld)
      const parentNew = parentOld
        ? // allow subtags to be moved into another tag
          tagNew.parent
          ? this.getParent(tagNew)
          : moveDown
            ? tagNew
            : // handle dragging a subtag to the last position within a tag
              tagPrev.parent
              ? this.getParent(tagPrev)
              : tagPrev
        : null

      // do not allow subtags to be moved to the top level
      if (parentOld && !parentNew) return

      // do not allow top-level tags to be moved to a subtag
      if (!parentOld && (moveDown ? tagNext : tagNew)?.parent) return

      const startIndex = Math.min(e.oldIndex, e.newIndex)
      const endIndex = Math.max(e.oldIndex, e.newIndex)
      const tagsToResort = this.tags.slice(startIndex, endIndex + 1)
      // .filter(tag => parentOld || !tag.parent)
      const startSortOrder = this.tags[startIndex].sortOrder

      // update tag sortOrders
      // subtags use 0.01 increment
      const increment = parentOld ? 0.01 : 1
      const updatesTags = tagsToResort
        .filter(tag => tag.id)
        .reduce(
          (accum, tag, i) => ({
            ...accum,
            [`${tag.id}/sortOrder`]: moveDown
              ? // shift up
                i === 0
                ? // move first item to the end
                  startSortOrder + (tagsToResort.length - 1) * increment
                : // shift other items up
                  startSortOrder + (i - 1) * increment
              : // shift down
                i === tagsToResort.length - 1
                ? // move last item to the beginning
                  startSortOrder
                : // shift other items down
                  startSortOrder + (i + 1) * increment,
          }),
          {},
        )

      // re-order subtags with parent.sortOrder + 0.01 increments
      // only when moving a top-level tag across the subtag list
      // ensures no conflicts with other tags
      // re-order all subtags that are affected by the move
      const updatesSubtags = !parentOld
        ? this.tags
            .filter(tag => tag.id && tag.parent)
            .reduce((accum, tag, i) => {
              // const parentSortOrder = updatesTags[`${parentOld ? tag.parent : tagOld.id}/sortOrder`]
              const parentSortOrder =
                updatesTags[`${tag.parent}/sortOrder`] || this.getParent(tag).sortOrder
              return {
                ...accum,
                [`${tag.id}/sortOrder`]: parentSortOrder + (i + 1) * 0.01,
              }
            }, {})
        : []

      // update parent if moving a subtag to a new parent
      const updatesParent =
        parentOld !== parentNew && tagOld.id
          ? {
              [`${tagOld.id}/parent`]: parentNew?.id || null,
            }
          : {}

      try {
        await this.$store.dispatch(`tags/${this.type}/update`, {
          path: '/',
          value: {
            ...updatesTags,
            ...updatesSubtags,
            ...updatesParent,
          },
        })
      } catch (e) {
        await this.$store.dispatch('ui/popup', {
          text: e.toString(),
          type: 'error',
          autoclose: false,
        })
      }
    },

    /** Gets the parent of the tag if it has one. */
    getParent(tag) {
      const tagIndex = this.tags.indexOf(tag)
      return tag.parent && tagIndex !== -1
        ? // eslint-disable-next-line fp/no-mutating-methods
          this.tags
            .slice(0, tagIndex)
            .reverse()
            .find(tag => !tag.parent)
        : null
    },

    /** Returns true if we are dragging a subtag to the top where it would have no parent. */
    isDraggingSubtagToTop(tag) {
      return tag === this.dragging && this.dragging.parent && this.dragTo === this.tags[0]
    },

    /** Returns true if we are dragging a top-level tag to a subtag. */
    isDraggingToSubtag(tag) {
      return tag === this.dragging && !this.dragging.parent && this.dragTo?.parent
    },

    /** Returns true if the tag's parent is being dragged. */
    isParentDragging(tag) {
      return this.dragging && this.dragging === this.getParent(tag)
    },

    numItems(tag) {
      const tagProp = this.type === 'people' ? 'identities' : 'tags'
      const allItems = this.$store.getters[`${this.type}/list`]()
      return allItems.filter(item => item[tagProp]?.[tag.id]).length || 0
    },

    async remove(id) {
      await this.$store.dispatch(`tags/${this.type}/remove`, id)
      this.resetNewTag()
    },

    resetNewTag() {
      this.newTag = {
        tag: '',
        showOnContributorForm: true,
        showOnPeopleForm: true,
        showOnFront: true,
        sortOrder: this.tags.length > 0 ? (this.tags[this.tags.length - 1].sortOrder || 0) + 1 : 1,
        weight: 1,
      }
    },

    toggleEditTag(id, state) {
      this.edits[id] = state
    },

    async toggleShowOnContributorForm(id) {
      const tag = this.$store.state.tags[this.type].data[id]
      tag.showOnContributorForm = !tag.showOnContributorForm || null
      await this.$store.dispatch(`tags/${this.type}/save`, {
        path: `${id}/showOnContributorForm`,
        value: tag.showOnContributorForm,
      })
    },

    async toggleShowOnPeopleForm(id) {
      const tag = this.$store.state.tags[this.type].data[id]
      tag.showOnPeopleForm = !tag.showOnPeopleForm || null
      await this.$store.dispatch(`tags/${this.type}/save`, {
        path: `${id}/showOnPeopleForm`,
        value: tag.showOnPeopleForm,
      })
    },

    async toggleShowOnFront(id) {
      const tag = this.$store.state.tags[this.type].data[id]
      tag.showOnFront = !tag.showOnFront || null
      await this.$store.dispatch(`tags/${this.type}/save`, {
        path: `${id}/showOnFront`,
        value: tag.showOnFront,
      })
    },

    async updateTag(tagid) {
      if (!tagid) {
        console.error('Missing tag id')
        return
      }
      const tag = { ...this.edits[tagid] }
      this.$store.commit('ui/setBusy', true)
      try {
        await this.$store.dispatch(`tags/${this.type}/save`, { path: tagid, value: tag })
      } finally {
        this.$store.commit('ui/setBusy', false)
      }
      this.edits[tagid] = null
    },
  },
}
</script>

<template>
  <table class="table w-100">
    <thead>
      <tr>
        <th style="width: 100%">Tag</th>

        <!-- # Books/People/Bundles -->
        <th
          class="has-text-centered"
          v-tippy="{
            content: `The number of books with this tag.`,
          }"
          style="white-space: nowrap"
        >
          {{ type === 'books' ? 'Books' : type === 'people' ? 'People' : 'Bundles' }}
          <i class="far fa-question-circle" />
        </th>

        <!-- Weight -->
        <th
          class="has-text-centered"
          v-tippy="{
            content: `Adjust the likelihood of ${type} with this tag being sorted to the top. For example, if Historical has a weight of 10 and all other tags have a weight of 1, then a Historical book will be 10 times more likely to be sorted to the top than a non-Historical book.`,
          }"
          style="white-space: nowrap"
        >
          Weight <i class="far fa-question-circle" />
        </th>

        <!-- Creator -->
        <th
          v-if="type === 'people'"
          class="has-text-centered"
          v-tippy="{
            content: `Show this tag as one of the identity options on the People Submission Form.`,
          }"
          style="white-space: nowrap"
        >
          Creator <i class="far fa-question-circle" />
        </th>

        <!-- Contributor -->
        <th
          v-if="type === 'people'"
          class="has-text-centered"
          v-tippy="{
            content: `Show this tag as one of the identity options on the Contributor Profile Form.`,
          }"
          style="white-space: nowrap"
        >
          Contributor <i class="far fa-question-circle" />
        </th>

        <!-- Show -->
        <th
          class="has-text-centered"
          v-tippy="{ content: `Show this tag in the ${type} filter menu` }"
          style="white-space: nowrap"
        >
          Show <i class="far fa-question-circle" />
        </th>

        <!-- Edit/Delete -->
        <th
          class="has-text-centered"
          v-tippy="{
            content: `Edit or delete this tag from all ${type}`,
          }"
          style="white-space: nowrap"
        >
          Edit/Delete <i class="far fa-question-circle" />
        </th>
      </tr>
    </thead>

    <!-- special filters -->
    <tbody class="special-filters">
      <tr v-for="filter of specialFilters" :key="filter.id">
        <td>
          <div class="field">
            <div class="control" style="opacity: 0.5">{{ filter.tag }}</div>
          </div>
        </td>
        <td />
        <td />
        <td />
        <td />
        <td v-if="type === 'people'" />
        <td />
      </tr>
    </tbody>

    <draggable
      v-model="tags"
      @start="dragStart"
      @end="dragEnd"
      :move="dragMove"
      item-key="id"
      tag="tbody"
    >
      <template #item="{ element: tag }">
        <tr
          :class="{ 'bg-secondary': tag === dragging }"
          :style="{
            ...(isParentDragging(tag) && { display: 'none' }),
            ...(isDraggingToSubtag(tag) || isDraggingSubtagToTop(tag)
              ? { backgroundColor: '#dbdbdb' }
              : null),
          }"
        >
          <!-- filters (comment cannot go in template -->

          <!-- tag -->
          <td style="cursor: grab" :style="tag.parent && { paddingLeft: 0 }">
            <div
              :style="
                tag.parent && {
                  borderBottom: '#dbdbdb',
                  margin: '-10px -20px -10px 0',
                  paddingLeft: '42px',
                }
              "
            >
              <div class="field">
                <div class="control">
                  <span v-if="edits[tag.id]"
                    ><input v-model="edits[tag.id].tag" type="text" class="input"
                  /></span>
                  <span v-else>{{ tag.tag }}</span>
                </div>
              </div>
            </div>
          </td>

          <!-- books -->
          <td class="has-text-right">
            <span class="ml-2">{{ numItems(tag) }}</span>
          </td>

          <!-- weight -->
          <td class="has-text-right">
            <span v-if="!edits[tag.id]">
              <span class="ml-2">{{ tag.weight }}</span>
            </span>
            <span v-if="edits[tag.id]">
              <input
                v-model.number="edits[tag.id].weight"
                type="number"
                class="input"
                style="min-width: 50px; padding-right: calc(0.75rem - 8px)"
                required
              />
            </span>
          </td>

          <!-- creator -->
          <td v-if="type === 'people'" class="has-text-centered">
            <a @click.prevent="toggleShowOnPeopleForm(tag.id)">
              <i v-if="tag.showOnPeopleForm" class="fas fa-check has-text-primary" />
              <i v-else class="fas fa-minus has-text-secondary" />
            </a>
          </td>

          <!-- contributor -->
          <td v-if="type === 'people'" class="has-text-centered">
            <a @click.prevent="toggleShowOnContributorForm(tag.id)">
              <i v-if="tag.showOnContributorForm" class="fas fa-check has-text-primary" />
              <i v-else class="fas fa-minus has-text-secondary" />
            </a>
          </td>

          <!-- show in book filters -->
          <td class="has-text-centered">
            <a v-if="!edits[tag.id]" @click.prevent="toggleShowOnFront(tag.id)">
              <i v-if="tag.showOnFront" class="fas fa-check has-text-primary" />
              <i v-else class="fas fa-minus has-text-secondary" />
            </a>
            <span v-if="edits[tag.id]"
              ><input v-model="edits[tag.id].showOnFront" type="checkbox" class="checkbox"
            /></span>
          </td>

          <!-- edit/delete -->
          <td>
            <div v-if="!edits[tag.id]" class="field is-grouped is-justify-content-flex-end">
              <p class="control">
                <button
                  :disabled="$uiBusy"
                  class="button is-flat"
                  @click.prevent="toggleEditTag(tag.id, tag)"
                >
                  <i class="fas fa-pencil-alt" />
                </button>
                <button
                  :disabled="$uiBusy"
                  class="button is-flat"
                  v-tippy="{
                    content: `Delete the '${tag.tag}' tag and remove from ${numItems(tag)} ${type}`,
                  }"
                  @click.prevent="remove(tag.id)"
                >
                  <i class="fas fa-times" />
                </button>
              </p>
            </div>
            <div v-if="edits[tag.id]" class="field is-grouped is-justify-content-flex-end">
              <p class="control">
                <button
                  :disabled="$uiBusy"
                  class="button is-rounded"
                  @click.prevent="toggleEditTag(tag.id, null)"
                >
                  <span>Cancel</span>
                </button>
              </p>
              <p class="control">
                <button
                  :disabled="$uiBusy"
                  class="button is-rounded is-primary"
                  @click.prevent="updateTag(tag.id)"
                >
                  <i class="fas fa-check mr-2" />
                  <span>Save</span>
                </button>
              </p>
            </div>
          </td>
        </tr>
      </template>
    </draggable>
  </table>

  <form class="w-100" @submit.prevent="addTag">
    <div class="field has-addons">
      <p class="control">
        <a class="button is-static">Add Tag</a>
      </p>
      <p class="control w-100">
        <input
          v-model="newTag.tag"
          type="text"
          :disabled="$uiBusy"
          class="input"
          placeholder="Enter tag"
        />
      </p>
      <p class="control">
        <a class="button" style="border: solid 1px #dbdbdb; border-left: 0">
          <label style="cursor: pointer; user-select: none">
            <span class="mr-2">Subtag</span>
            <input
              v-model="newTag.parent"
              type="checkbox"
              :false-value="null"
              :true-value="defaultSubtagParent"
              class="checkbox"
            />
          </label>
        </a>
      </p>
      <p class="control">
        <button :disabled="$uiBusy" type="submit" class="button is-primary">
          <i class="fas fa-plus mr-2" />
          <span>Add</span>
        </button>
      </p>
    </div>
  </form>
</template>

<style lang="scss" scoped>
table th:last-child {
  text-align: right;
}
table td {
  vertical-align: middle;
}
// set border-bottom on the special-filters table, otherwise it will omit the border on the last row
.table .special-filters td {
  border-bottom-width: 1px;
}
</style>

<style lang="scss">
.grabbing * {
  cursor: grabbing;
}
</style>
