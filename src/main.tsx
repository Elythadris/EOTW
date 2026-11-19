import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import App from './App'
import { routeIdentityCallback } from './Account'
import './styles.css'

class ReaderBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){ return {failed:true} }
  render(){
    if(this.state.failed)return <main className="recover"><h1>Reader unavailable</h1><p>The interface could not load this view. Reload to reconnect.</p><button className="primary" onClick={()=>window.location.reload()}>Reload EOTW</button></main>
    return this.props.children
  }
}
routeIdentityCallback()
createRoot(document.getElementById('root')!).render(<ReaderBoundary><App/></ReaderBoundary>)

if(import.meta.env.PROD && 'serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{ /* Live reading works without offline shell storage. */ })
  },{once:true})
}
