<script>
import creatorTitles from '@/store/constants/creatorTitles'
import Dropdown from '@/components/Dropdown'
import PersonDetailLink from '@/components/PersonDetailLink'

export default {
  components: {
    Dropdown,
    PersonDetailLink,
  },
  props: {
    // link to admin edit pages instead of public detail pages
    edit: Boolean,
    id: {
      required: true,
      type: String,
    },
    role: {
      required: true,
      type: String,
    },
    // if true, prevents "words and pictures by" from being shortened to "by"
    longlabel: Boolean,
  },
  emits: ['remove', 'updateTitle'],
  data() {
    return {
      creatorTitles,
      title: this.role,
    }
  },
  computed: {
    creator() {
      return this.$store.state.people.data?.[this.id]
    },
    photoUrl() {
      return this.creator?.photo?.url || this.creator?.photo
    },
    titleIntro() {
      const intro =
        this.role === 'author'
          ? 'words '
          : this.role === 'illustrator'
          ? 'pictures '
          : this.longlabel
          ? 'words and pictures '
          : ''
      return `${intro}by`
    },
  },
  methods: {
    updateTitle(titleId) {
      this.$emit('updateTitle', titleId)
    },

    remove() {
      this.$emit('remove')
    },
  },
}
</script>

<template>
  <div class="is-flex is-uppercase mb-10" style="line-height: 1.7">
    <PersonDetailLink v-if="creator" :person="creator" :edit="edit" class="primary-hover"
      ><div
        class="bg-secondary"
        :style="{
          minWidth: '70px',
          minHeight: '70px',
          width: '70px',
          height: '70px',
          borderRadius: '999px',
          marginRight: '10px',
          overflow: 'hidden',
        }"
      >
        <div
          v-if="photoUrl"
          :style="{
            backgroundImage: `url(${photoUrl})`,
            backgroundSize: 'cover',
            height: '100%',
            width: '100%',
          }"
        /></div
    ></PersonDetailLink>

    <div class="mt-20">
      <div class="mr-2">
        <!-- dropdown -->
        <Dropdown
          v-if="edit"
          v-model="title"
          :label="titleIntro"
          labelStyle="font-weight: bold;"
          :options="creatorTitles"
          @update:modelValue="updateTitle($event)"
          style="display: block"
        >
          <template #beforeOptions>
            <a class="dropdown-item" @click.prevent="remove"><b>REMOVE CREATOR</b></a>
            <hr class="dropdown-divider" />
          </template>
        </Dropdown>

        <!-- By / Words by / Illutsratored by -->
        <div v-else style="font-weight: bold; white-space: nowrap">{{ titleIntro }}</div>
      </div>

      <PersonDetailLink v-if="creator" :person="creator" :edit="edit" class="primary-hover">{{
        creator.name
      }}</PersonDetailLink>
    </div>
  </div>
</template>
