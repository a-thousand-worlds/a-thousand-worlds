/**
 * Characterizes the seams between the CKEditor balloon build and the Firebase upload adapter.
 * Guards @ckeditor/ckeditor5-build-balloon: loading a plain-function plugin through extraPlugins,
 * the FileRepository / FileLoader UploadAdapter contract (upload, abort, progress, status,
 * uploadResponse), the ImageUpload feature consuming the { default: url } response, and the
 * setData/getData pipeline that shapes the stored book summaries and person bios.
 * Firebase storage is the boundary and is faked with the v8 namespaced API the adapter calls.
 */
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import FirebaseUploadAdapter from './ckeditorFirebaseUploadAdapter'

/** A fake of firebase.storage().ref(path).put(file) whose task settles according to state.mode. */
const fake = vi.hoisted(() => {
  const state = { mode: 'ok', snapshot: null, error: null, puts: [], tasks: [] }

  /** Creates an upload task that succeeds, fails, or stays pending, as Firebase's task.on does. */
  const makeTask = () => {
    const task = {
      callbacks: null,
      on: vi.fn((event, next, error, complete) => {
        task.callbacks = { next, error, complete }
        if (state.mode === 'ok') {
          next(state.snapshot)
          complete()
        } else if (state.mode === 'error') {
          error(state.error)
        }
      }),
      // Firebase rejects a cancelled task through its error observer with storage/canceled
      cancel: vi.fn(() => {
        task.callbacks?.error(new Error('storage/canceled'))
      }),
    }
    return task
  }

  const ref = vi.fn(path => ({
    put: file => {
      const task = makeTask()
      state.puts = [...state.puts, file]
      state.tasks = [...state.tasks, task]
      return task
    },
    getDownloadURL: async () => `https://storage.example.test/${path}`,
  }))

  return { state, ref }
})

vi.mock('@/firebase', () => ({ default: { storage: () => ({ ref: fake.ref }) } }))

let el
let editor
let log
let alert

/** Creates a balloon editor configured the way CEditor.vue configures it. */
const createEditor = async () => {
  editor = await BalloonEditor.create(el, { extraPlugins: [FirebaseUploadAdapter] })
  return editor
}

/** Returns a small PNG File whose name contains a space, to show the name is used raw. */
const pngFile = (name = 'a b.png') => new File(['abc'], name, { type: 'image/png' })

beforeEach(() => {
  Object.assign(fake.state, {
    mode: 'ok',
    snapshot: { totalBytes: 3, bytesTransferred: 3 },
    error: null,
    puts: [],
    tasks: [],
  })
  fake.ref.mockClear()
  // jsdom has no ResizeObserver, and the balloon toolbar constructs one
  vi.stubGlobal('ResizeObserver', function () {
    return { observe() {}, unobserve() {}, disconnect() {} }
  })
  // the adapter logs upload failures
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  // CKEditor's default Notification shows upload warnings with window.alert, which jsdom lacks
  alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  el = document.createElement('div')
  document.body.appendChild(el)
})

afterEach(async () => {
  await editor?.destroy()
  editor = null
  el.remove()
  log.mockRestore()
  alert.mockRestore()
  vi.unstubAllGlobals()
})

describe('plugin loading', () => {
  test('BalloonEditor accepts the plain-function plugin and it installs createUploadAdapter', async () => {
    await createEditor()
    const repo = editor.plugins.get('FileRepository')

    expect(typeof repo.createUploadAdapter).toBe('function')
    const adapter = repo.createUploadAdapter({ file: Promise.resolve(null) })
    expect(typeof adapter.upload).toBe('function')
    expect(typeof adapter.abort).toBe('function')
  })
})

describe('FileRepository loader upload', () => {
  test('resolves with the download URL of content/<raw file name> as { default }', async () => {
    await createEditor()
    const file = pngFile()
    const loader = editor.plugins.get('FileRepository').createLoader(file)

    await expect(loader.upload()).resolves.toEqual({
      default: 'https://storage.example.test/content/a b.png',
    })
    expect(fake.ref).toHaveBeenCalledTimes(1)
    expect(fake.ref).toHaveBeenCalledWith('content/a b.png')
    expect(fake.state.puts).toHaveLength(1)
    expect(fake.state.puts[0]).toBe(file)
    expect(fake.state.tasks[0].on).toHaveBeenCalledTimes(1)
    expect(fake.state.tasks[0].on.mock.calls[0][0]).toBe('state_changed')
    expect(loader.status).toBe('idle')
    expect(loader.uploadResponse).toEqual({
      default: 'https://storage.example.test/content/a b.png',
    })
  })

  test('storage progress snapshots become loader and repository progress', async () => {
    fake.state.snapshot = { totalBytes: 10, bytesTransferred: 4 }
    await createEditor()
    const repo = editor.plugins.get('FileRepository')
    const loader = repo.createLoader(pngFile())

    await loader.upload()

    expect(loader.uploadTotal).toBe(10)
    expect(loader.uploaded).toBe(4)
    expect(loader.uploadedPercent).toBe(40)
    expect(repo.uploadTotal).toBe(10)
    expect(repo.uploaded).toBe(4)
    expect(repo.uploadedPercent).toBe(40)
  })

  test('a storage error rejects with that same error and marks the loader as errored', async () => {
    const error = new Error('storage/unauthorized')
    fake.state.mode = 'error'
    fake.state.error = error
    await createEditor()
    const loader = editor.plugins.get('FileRepository').createLoader(pngFile())

    await expect(loader.upload()).rejects.toBe(error)
    expect(loader.status).toBe('error')
    expect(log).toHaveBeenCalledWith('error on content file upload', error)
  })

  test('abort after the task has started cancels it once and rejects with "aborted"', async () => {
    fake.state.mode = 'pending'
    await createEditor()
    const loader = editor.plugins.get('FileRepository').createLoader(pngFile())

    const upload = loader.upload()
    // the firebase module is imported lazily, so the task exists only after a few ticks
    await vi.waitFor(() => expect(fake.state.tasks).toHaveLength(1))
    loader.abort()

    expect(fake.state.tasks[0].cancel).toHaveBeenCalledTimes(1)
    await expect(upload).rejects.toBe('aborted')
    expect(loader.status).toBe('aborted')
  })
})

describe('uploadImage command', () => {
  test('sets the inserted image src from the { default } URL and releases the loader', async () => {
    await createEditor()
    const repo = editor.plugins.get('FileRepository')

    editor.execute('uploadImage', { file: [pngFile()] })

    await vi.waitFor(() =>
      expect(editor.getData()).toBe(
        '<figure class="image"><img src="https://storage.example.test/content/a b.png"></figure>',
      ),
    )
    expect(repo.loaders.length).toBe(0)
    expect(alert).not.toHaveBeenCalled()
  })

  test('a failed upload removes the image and raises the storage error as an alert', async () => {
    const error = new Error('storage/unauthorized')
    fake.state.mode = 'error'
    fake.state.error = error
    await createEditor()

    editor.execute('uploadImage', { file: [pngFile()] })
    expect(editor.getData()).toBe('<figure class="image"><img></figure>')

    await vi.waitFor(() => expect(alert).toHaveBeenCalledTimes(1))
    expect(alert).toHaveBeenCalledWith(error)
    expect(editor.getData()).toBe('')
    expect(log).toHaveBeenCalledWith('error on content file upload', error)
  })
})

describe('balloon build data pipeline for stored summaries and bios', () => {
  test.each([
    [
      '<p>Hi <b>x</b> <a href="https://a.b" target="_blank">l</a></p>',
      '<p>Hi <strong>x</strong> <a href="https://a.b">l</a></p>',
    ],
    ['plain text', '<p>plain text</p>'],
    ['', ''],
    ['<p>a <em>b</em> <u>c</u> <s>d</s></p>', '<p>a <i>b</i> c d</p>'],
    ['<p><span class="k" style="color:red">x</span> y&nbsp;z</p>', '<p>x y&nbsp;z</p>'],
    ['<div>x</div><div>y</div>', '<p>x</p><p>y</p>'],
    ['<p>a</p>\n<p>  b  </p>', '<p>a</p><p>b</p>'],
    ['<p>a<br>b</p>', '<p>a<br>b</p>'],
    ['<ul><li>a</li><li>b</li></ul>', '<ul><li>a</li><li>b</li></ul>'],
  ])('setData(%j) is read back by getData() as %j', async (input, output) => {
    await createEditor()

    editor.setData(input)

    expect(editor.getData()).toBe(output)
  })
})
