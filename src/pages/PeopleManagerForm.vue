<!-- DEPRECATED. Use Book Submission Form. -->
<script>
import Jimp from 'jimp'

export default {
  data() {
    return {
      mode: 'new',
      searching: false,
      found: false,
      photoType: null,
      photoSize: 0,
      person: {
        id: null,
        name: '',
        bio: '',
        photo: '',
        file: null,
        role: 'author',
      },
    }
  },
  computed: {
    photoUrl() {
      if (!this.person.photo || !this.person.photo.length) {
        return null
      }
      return this.person.photo
    },
    photoSizeD() {
      if (!this.photoSize) {
        return null
      }
      let sz = Math.floor((this.photoSize * 100) / 1024) / 100 // kb
      if (sz < 1024) {
        return sz + 'kb'
      }
      sz = Math.floor((sz * 100) / 1024) / 100 // mb
      return sz + 'mb'
    },
  },
  created() {
    if (this.$router.currentRoute._value.name === 'PeopleManagerUpdateForm') {
      const p = this.$store.state.peopleIndex[this.$route.params.uid] || null
      if (p) {
        this.person = p
        this.mode = 'update'
      }
    }
  },
  methods: {
    fileChange(e) {
      const file = e.target.files[0]
      const reader = new FileReader()
      this.person.photo = ''
      this.photoType = null
      reader.onload = () => {
        this.photoType = file.type
        this.person.file = file
        this.photoSize = file.size
        this.person.photo = reader.result
        Jimp.read(reader.result, (err, img) => {
          if (err) {
            console.error('jimp error', err)
          }
          if (img) {
            if (img.bitmap.width !== img.bitmap.height) {
              alert('recommended to use suqare images')
            }
          }
        })
      }
      reader.onerror = err => {
        console.error('FileReader error', err)
      }
      reader.readAsDataURL(file)
    },
    save() {
      this.$store.dispatch('savePerson', this.person).then(() => {
        this.$router.push({ name: 'PeopleManager' })
      })
    },
  },
}
</script>

<template>
  <h1 v-if="mode === 'new'" class="title page-title">Add Person</h1>
  <h1 v-if="mode !== 'new'" class="title page-title">Update Person</h1>

  <section class="section">
    <form @submit.prevent="save">
      <div class="columns">
        <div class="column is-one-third">
          <div id="photo-wrapper">
            <img v-if="photoUrl" :src="photoUrl" />
          </div>
          <small v-if="photoSizeD">{{ photoSizeD }}</small>
          <input type="file" class="file" @change.prevent="fileChange($event)" />
        </div>
        <div class="column is-two-thirds">
          <div class="field">
            <label class="label">Name</label>
            <div class="control">
              <input v-model="person.name" type="text" class="input" />
            </div>
          </div>

          <div class="field">
            <label class="label">Role</label>
            <div class="control">
              <div class="select">
                <select v-model="person.role">
                  <option value="author">Author</option>
                  <option value="illustrator">Illustrator</option>
                </select>
              </div>
            </div>
          </div>

          <div class="field">
            <label class="label">Biography</label>
            <div class="control">
              <textarea v-model="person.bio" class="textarea" />
            </div>
          </div>
        </div>
      </div>
      <div class="">
        <input type="submit" class="button is-primary" value="Save" />
        <router-link class="button is-secondary ml-3" :to="{ name: 'PeopleManager' }"
          >Cancel</router-link
        >
      </div>
    </form>
  </section>
</template>

<style scoped lang="scss">
@use '@/assets/style/mixins.scss' as *;

#iff-isbn {
  width: 0px !important;
  height: 0px !important;
}

#photo-wrapper {
  @include primary(border-color);
  width: 300px;
  height: 300px;
  background: #ccc;
  border: 2px solid;
  border-radius: 50%;
  overflow: hidden;
  text-align: center;

  img {
    height: 100%;
    width: auto;
  }
}
</style>
