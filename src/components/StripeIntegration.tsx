import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Save, Key, HelpCircle, Info, Settings, CheckCircle, AlertCircle, Loader2, Link2, Copy, Send, Mail
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface StripeSettings {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

export default function StripeIntegration() {
  const [settings, setSettings] = useState<StripeSettings>({
    publishableKey: '',
    secretKey: '',
    webhookSecret: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [backendConfigured, setBackendConfigured] = useState<boolean | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Webhook URL endpoint for convenience
  const webhookUrl = `${window.location.origin}/api/stripe/webhook`;

  useEffect(() => {
    async function loadSettingsAndConfig() {
      try {
        // 1. Load from Firestore settings
        const stripeSettingsDoc = await getDoc(doc(db, 'settings', 'stripe'));
        if (stripeSettingsDoc.exists()) {
          setSettings(stripeSettingsDoc.data() as StripeSettings);
        }

        // 2. Check backend configuration
        const res = await fetch('/api/stripe/config');
        const data = await res.json();
        setBackendConfigured(data.configured);
      } catch (err) {
        console.error("Error loading Stripe settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettingsAndConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveStatus('idle');
    try {
      await setDoc(doc(db, 'settings', 'stripe'), settings);
      
      // Re-trigger backend check
      const res = await fetch('/api/stripe/config');
      const data = await res.json();
      setBackendConfigured(data.configured);

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error("Error saving Stripe settings:", err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500 animate-pulse">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <p className="font-bold">Cargando Configuración de Stripe...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h3 className="text-xl font-bold text-gray-900">Pasarela de Pagos Stripe</h3>
        <p className="text-gray-500 text-sm">Configura la pasarela de pagos Stripe para habilitar el envío automático de ligas de cobro por correo y WhatsApp, cobro seguro con tarjeta, y la conciliación bancaria automatizada.</p>
      </div>

      {/* Backend Status Check */}
      <div className={`p-4 rounded-2xl border flex items-start gap-3 text-xs ${
        backendConfigured 
          ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
          : 'bg-amber-50 border-amber-100 text-amber-800'
      }`}>
        {backendConfigured ? (
          <>
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">¡Pasarela Stripe Activa y Lista!</p>
              <p className="mt-1 opacity-90 leading-relaxed">El backend ha cargado exitosamente las claves de Stripe. La generación de ligas de pago seguras de checkout está disponible para las pólizas y abonos.</p>
            </div>
          </>
        ) : (
          <>
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Claves de Stripe Pendientes</p>
              <p className="mt-1 opacity-90 leading-relaxed">Faltan las credenciales para inicializar la pasarela de cobro. Por favor, ingresa tus claves de Stripe de producción o de prueba (sandbox) a continuación para activar esta integración.</p>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form Column */}
        <form onSubmit={handleSave} className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
            <h4 className="font-bold text-gray-900 text-base border-b border-gray-100 pb-3 flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-600" />
              Credenciales de la API de Stripe
            </h4>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Clave Pública (Publishable Key)</label>
                <input
                  type="text"
                  placeholder="pk_test_..."
                  value={settings.publishableKey || ''}
                  onChange={(e) => setSettings({ ...settings, publishableKey: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Inicia con pk_test_ para pruebas o pk_live_ para producción.</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Clave Secreta (Secret Key)</label>
                <input
                  type="password"
                  placeholder="sk_test_..."
                  value={settings.secretKey || ''}
                  onChange={(e) => setSettings({ ...settings, secretKey: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Inicia con sk_test_ o sk_live_. Se encripta y almacena con absoluta seguridad en la base de datos.</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Firma Secreta del Webhook (Webhook Secret)</label>
                <input
                  type="password"
                  placeholder="whsec_..."
                  value={settings.webhookSecret || ''}
                  onChange={(e) => setSettings({ ...settings, webhookSecret: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 transition-colors font-mono"
                />
                <span className="text-[10px] text-gray-400 mt-1 block">Opcional. Se utiliza para verificar criptográficamente que las llamadas recibidas en tu webhook provienen legítimamente de Stripe.</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              {saveStatus === 'success' && (
                <p className="text-xs text-emerald-600 font-bold flex items-center gap-1.5 animate-bounce">
                  <CheckCircle className="w-4 h-4" /> Configuración de Stripe guardada con éxito
                </p>
              )}
              {saveStatus === 'error' && (
                <p className="text-xs text-red-600 font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> Fallo al guardar credenciales en la base de datos
                </p>
              )}
              <div className="ml-auto">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs px-6 py-3 rounded-xl shadow-lg shadow-blue-200 hover:shadow-xl hover:shadow-blue-300 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" /> Guardar Cambios
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Sidebar Help Column */}
        <div className="space-y-6">
          <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-6">
            <h4 className="font-bold text-gray-900 text-sm flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-600" />
              Instrucciones de Configuración
            </h4>

            <div className="text-xs space-y-4 text-gray-600 leading-relaxed">
              <div>
                <p className="font-bold text-gray-800 mb-1">1. Obtener claves:</p>
                <p>Inicia sesión en tu cuenta de <a href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer" className="text-blue-600 font-semibold hover:underline">Stripe Dashboard</a>, ve al menú de Desarrolladores (Developers) &gt; API Keys y copia la Clave pública y la Clave secreta.</p>
              </div>

              <div>
                <p className="font-bold text-gray-800 mb-1">2. Configurar Webhook:</p>
                <p>Para la conciliación automatizada en tiempo real, registra la siguiente URL en Stripe Dashboard &gt; Webhooks:</p>
                <div className="mt-2 flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200 font-mono text-[10px] select-all relative overflow-hidden group">
                  <span className="truncate flex-1 text-gray-850 font-bold">{webhookUrl}</span>
                  <button
                    onClick={() => copyToClipboard(webhookUrl, 'webhook')}
                    className="p-1 hover:bg-gray-100 rounded text-gray-400 group-hover:text-blue-600 shrink-0"
                    title="Copiar URL"
                    type="button"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {copiedText === 'webhook' && (
                    <span className="absolute right-2 bg-blue-600 text-white font-bold text-[9px] px-1.5 py-0.5 rounded shadow">¡Copiado!</span>
                  )}
                </div>
              </div>

              <div>
                <p className="font-bold text-gray-800 mb-1">3. Eventos requeridos:</p>
                <p>Al dar de alta el Webhook, suscríbete únicamente al evento de <strong className="text-blue-700">checkout.session.completed</strong>.</p>
              </div>

              <div>
                <p className="font-bold text-gray-800 mb-1">4. Conciliación Automática:</p>
                <p>Cuando un cliente pague exitosamente la póliza a través de Stripe Checkout, el backend marcará la póliza como "Pagada", creará el recibo digital y emitirá la alerta por WhatsApp sin intervención del equipo administrativo.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
