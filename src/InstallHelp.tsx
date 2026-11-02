import { useEffect, useState } from 'react'
import type { DeferredInstallPromptEvent } from './types'

export default function InstallHelp() {
  const [prompt, setPrompt] = useState<DeferredInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)')
    const refresh = () => setInstalled(media.matches)
    refresh()
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as DeferredInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    media.addEventListener('change', refresh)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      media.removeEventListener('change', refresh)
    }
  }, [])

  async function install() {
    if (!prompt) {
      setShowHelp(true)
      return
    }
    try {
      await prompt.prompt()
      await prompt.userChoice
      setPrompt(null)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Kunne ikke åpne installasjon.')
    }
  }

  if (installed) return null
  return (
    <section className="install-help">
      <button type="button" onClick={install}>Installer app</button>
      <button type="button" onClick={() => setShowHelp(value => !value)} aria-expanded={showHelp}>
        {showHelp ? 'Skjul veiledning' : 'iPhone / Android / PC'}
      </button>
      {showHelp && (
        <div className="card" role="region" aria-label="Slik installerer du appen">
          <h2>Legg appen på hjemskjermen eller skrivebordet</h2>
          <ul>
            <li><strong>iPhone/iPad:</strong> Åpne appens nettadresse i Safari. Trykk Del, deretter «Legg til på Hjem-skjerm», og velg «Legg til».</li>
            <li><strong>Android:</strong> Åpne nettadressen i Chrome. Trykk «Installer app», eller velg «Installer app / Legg til på startskjermen» i nettlesermenyen.</li>
            <li><strong>Windows/Mac:</strong> Åpne i Chrome eller Edge, og velg installasjonsikonet i adressefeltet. På nyere Mac kan du også bruke Safari → Arkiv → Legg til i Dock.</li>
          </ul>
          <p className="mini">Dette er en nettapp, ikke en App Store-/Play Store-nedlasting. Nettadressen må bruke HTTPS. Innlogging og synkronisering krever internett.</p>
        </div>
      )}
    </section>
  )
}
