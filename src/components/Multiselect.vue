<script>
import Tag from '@/components/Tag'

/** A generic multiselect dropdown menu with support for sub-options. */
export default {
  components: {
    Tag,
  },
  props: {
    label: {
      type: String,
      required: true,
    },
    options: {
      type: Array,
      required: true,
    },
    // options that should be selected in the dropdown by id
    selected: {
      type: Array,
      validator: arr => Array.isArray(arr) && arr.every(option => option.id),
    },
  },
  emits: ['select'],
  data() {
    return {
      dropdownActive: false,
    }
  },
  computed: {
    /** Precalculate parents for O(1) lookup. */
    parents() {
      return this.options.reduce(
        (accum, option) => ({
          ...accum,
          ...(option.parent ? { [option.parent]: true } : null),
        }),
        {},
      )
    },

    // convert the selected options to an id object that can be looked up in O(1)
    selectedIds() {
      return (
        this.selected?.reduce(
          (accum, option) => ({
            ...accum,
            [option.id]: true,
          }),
          {},
        ) || {}
      )
    },
  },
  methods: {
    // function declaration needed for v-click-outside
    closeDropdown() {
      this.dropdownActive = false
    },

    /** Returns true if an option has one or more sub-options. */
    isParent(option) {
      return this.parents[option.id]
    },

    /** Emits the select event with the selected option. */
    select(option) {
      this.closeDropdown()
      this.$emit('select', { option, value: !this.selectedIds[option.id] })
    },
  },
}
</script>

<template>
  <span>
    <!-- dropdown -->
    <div
      class="dropdown mt-4 no-user-select"
      :class="{ 'is-active': dropdownActive }"
      style="text-align: left"
    >
      <div id="dropdown-menu" class="dropdown-menu" role="menu">
        <div class="dropdown-content" style="max-height: 19.5em; overflow: scroll">
          <a
            v-for="option in options"
            :key="option.id"
            @click.prevent.stop="!isParent(option) ? select(option) : null"
            :class="{
              'ml-20': option.parent,
            }"
            class="dropdown-item is-capitalized"
            :style="{
              // highlight selected
              color: !selectedIds[option.id] ? '#000' : null,
              // disable hover on parents
              cursor: isParent(option) ? 'default' : null,
              backgroundColor: isParent(option) ? '#fff' : null,
            }"
          >
            {{ option.tag }}
          </a>
        </div>
      </div>
    </div>

    <!-- add tag -->
    <Tag
      :tag="{ tag: label }"
      nolink
      tagStyle="background-color: #fff; border-color: #000; color: #000 !important; cursor: pointer"
      v-click-outside="closeDropdown"
      @click="dropdownActive = !dropdownActive"
    />
  </span>
</template>

<style lang="scss">
@use '@/assets/style/mixins.scss' as *;

hr.dropdown-divider {
  background-color: #ccc;
}

.add-tag {
  span,
  a {
    color: #000;
  }

  &.button.is-primary.nolink:hover {
    @include primary(background-color, !important);
    @include primary(border-color, !important);
    & span {
      color: #fff !important;
    }
  }
}
</style>
