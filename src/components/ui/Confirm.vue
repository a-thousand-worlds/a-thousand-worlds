<script>
export default {}
</script>

<template>
  <div v-if="$store.state.ui.dlgConfirm" class="modal is-active">
    <div class="modal-background" />
    <div class="modal-content">
      <div class="popup message" :class="`is-${$store.state.ui.dlgConfirm.type}`">
        <div class="message-header">{{ $store.state.ui.dlgConfirm.header }}</div>
        <div class="message-body">
          {{ $store.state.ui.dlgConfirm.text }}
        </div>
        <div class="field is-grouped is-justify-content-flex-end p-3">
          <div class="control">
            <button class="button is-secondary" @click.prevent="$store.commit('ui/confirm', false)">
              Cancel
            </button>
          </div>
          <div class="control">
            <button class="button is-primary" @click.prevent="$store.commit('ui/confirm', true)">
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
