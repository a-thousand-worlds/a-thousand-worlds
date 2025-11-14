<script>
export default {
  name: 'SortableTableHeading',
  props: {
    modelValue: {},
    id: {
      type: String,
      required: true,
    },
    default: {
      type: String,
      validator: value => ['asc', 'desc'].indexOf(value) !== -1,
      default: 'asc',
    },
  },
  emits: ['update:modelValue'],
  data() {
    return {
      sortConfig: this.modelValue || {
        field: null,
        dir: null,
      },
    }
  },
  watch: {
    modelValue(next) {
      this.sortConfig = next
    },
  },
  methods: {
    sort(field) {
      this.sortConfig = {
        field,
        dir:
          this.sortConfig.field === field
            ? this.sortConfig.dir === 'desc'
              ? 'asc'
              : 'desc'
            : this.default,
      }
      this.$emit('update:modelValue', this.sortConfig)
    },
  },
}
</script>

<template>
  <th class="nowrap" style="cursor: pointer; user-select: none" @click="sort(id)">
    <slot />
    <i
      :class="`ml-1 fas fa-arrow-${sortConfig.dir === 'desc' ? 'down' : 'up'}`"
      :style="{
        visibility: sortConfig.field === id ? 'visible' : 'hidden',
        position: 'absolute',
        lineHeight: 1.5,
      }"
    />
  </th>
</template>
