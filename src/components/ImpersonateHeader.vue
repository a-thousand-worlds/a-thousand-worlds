<script>
import _ from 'lodash'
import Dropdown from '@/components/Dropdown.vue'
import { allowedInvitees } from '@/rights'

export default {
  components: {
    Dropdown,
  },
  data() {
    return {
      roleOptions: Object.keys(allowedInvitees)
        .filter(role => role !== 'owner')
        .map(role => ({ id: role, text: _.capitalize(role) })),
    }
  },
  computed: {
    role() {
      return this.$store.state.user.impersonate
    },
  },
  methods: {
    impersonate(role) {
      this.$store.commit('user/impersonate', role)
    },
    close() {
      this.$store.commit('user/impersonate', null)
    },
  },
}
</script>

<template>
  <div v-if="role">
    <div style="height: 50px" />
    <div
      class="bg-primary py-2 has-text-centered"
      style="position: fixed; z-index: 99; top: 0; width: 100%; height: 50px; line-height: 2em"
    >
      Viewing site as:

      <!-- <Dropdown style="font-weight: bold; text-transform: uppercase">{{ role }}</span> -->

      <Dropdown
        :options="roleOptions"
        :v-model="role"
        @update:model-value="impersonate"
        :label="role"
        labelStyle="text-transform: uppercase; font-weight: bold; color: #fff;"
        placeholder="Choose Role"
        style="display: inline-block"
        class="has-text-left"
      >
        <template #beforeOptions>
          <a
            @click.prevent="impersonate(null)"
            class="dropdown-item is-capitalized is-uppercase"
            style="color: #000; font-weight: bold"
            >Close</a
          >
        </template>
      </Dropdown>
      <span style="position: absolute">
        <button @click.prevent="close" class="delete ml-5" style="vertical-align: middle" />
      </span>
    </div>
  </div>
</template>
