import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, AlertTriangle, Eye, EyeOff, KeyRound, ArrowLeft, Mail, RefreshCw } from 'lucide-react';
import { supabase } from '../services/supabase';

type AuthView = 'signin' | 'signup' | 'forgot';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<AuthView>('signin');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check for errors in the URL fragment
    const hash = window.location.hash;
    if (hash) {
      // Handle Supabase error fragments
      const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
      const errorDescription = params.get('error_description');
      const errorCode = params.get('error_code');
      const error = params.get('error');
      
      if (errorDescription || error) {
        let msg = decodeURIComponent(errorDescription || error || 'Authentication error').replace(/\+/g, ' ');
        
        // Custom message for expired OTP/Links
        if (errorCode === 'otp_expired' || msg.toLowerCase().includes('expired')) {
             msg = 'This link has expired or has already been used. Please try signing in. If you have not confirmed your email yet, please try signing up again or contact support.';
        }

        setErrorMessage(msg);
        // Clean URL but keep us on the login page if possible
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }, []);

  // Auto-clear success message after a delay to allow reading
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 20000); // 20 seconds to allow time to read the detailed message
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const clearMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const switchView = (newView: AuthView) => {
    clearMessages();
    setView(newView);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    clearMessages();
    
    try {
      if (view === 'signup') {
        // Construct the redirect URL to point explicitly to the login page
        // We use window.location.origin to get the base domain (e.g. localhost:5173)
        // And append /#/login because we are using HashRouter
        const redirectUrl = `${window.location.origin}/#/login`;

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { role: 'photographer' },
            emailRedirectTo: redirectUrl
          }
        });
        if (error) throw error;
        setSuccessMessage('Check your email for the confirmation link! Tip: Try signing in with your email and password. If the account was actually confirmed (despite any error), it will just work.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate('/dashboard');
      }
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    clearMessages();

    try {
      const redirectUrl = `${window.location.origin}/#/login`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;
      setSuccessMessage('Password reset instructions have been sent to your email.');
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email) {
        setErrorMessage("Please enter your email address first.");
        return;
    }
    setLoading(true);
    clearMessages();
    try {
        const redirectUrl = `${window.location.origin}/#/login`;
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email: email,
            options: {
                emailRedirectTo: redirectUrl
            }
        });
        if (error) throw error;
        setSuccessMessage('Confirmation email resent! Please check your inbox.');
    } catch (error: any) {
        setErrorMessage(error.message);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-8">
            <div className="bg-emerald-100 p-3 rounded-full mb-3">
                <Camera className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">ProGallery</h1>
            <p className="text-slate-500">Photographer Portal</p>
        </div>

        {errorMessage && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex flex-col items-start gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
            {/* Show resend button if looking like an expired link */}
            {(errorMessage.includes('expired') || errorMessage.includes('invalid')) && view === 'signin' && (
                <button 
                    onClick={() => {
                        setView('signup'); // Switch to signup so they can try again or see the email field
                        setErrorMessage("Please enter your email to resend the confirmation.");
                    }}
                    className="text-xs text-red-600 underline hover:text-red-800 ml-8"
                >
                    Need a new link? Click here.
                </button>
            )}
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start space-x-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <Mail className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-700 leading-relaxed">{successMessage}</p>
          </div>
        )}

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-slate-500">
              {view === 'signin' && 'Sign in to your account'}
              {view === 'signup' && 'Create a new account'}
              {view === 'forgot' && 'Reset your password'}
            </span>
          </div>
        </div>

        {view === 'forgot' ? (
          /* Forgot Password Form */
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                required
                placeholder="you@example.com"
              />
              <p className="mt-2 text-xs text-slate-500">
                We'll send you a link to reset your password.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={() => switchView('signin')}
              className="w-full text-slate-600 py-2 text-sm font-medium hover:text-slate-900 flex justify-center items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </button>
          </form>
        ) : (
          /* Sign In / Sign Up Form */
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                required
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none pr-10"
                  required
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {view === 'signin' && (
                <div className="flex justify-end mt-1">
                  <button
                    type="button"
                    onClick={() => switchView('forgot')}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    Forgot Password?
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Processing...' : (view === 'signup' ? 'Create Account' : 'Sign In')}
            </button>

            {/* Resend Confirmation Button (only visible in signup view to keep UI clean, or if we want to expose it explicitly) */}
            {view === 'signup' && (
                <div className="mt-2 text-center">
                    <button
                        type="button"
                        onClick={handleResendConfirmation}
                        disabled={loading || !email}
                        className="text-xs text-slate-500 hover:text-emerald-600 flex items-center justify-center gap-1 mx-auto"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Resend Confirmation Email
                    </button>
                </div>
            )}
          </form>
        )}

        {view !== 'forgot' && (
          <div className="mt-6 text-center">
            <button
              onClick={() => switchView(view === 'signin' ? 'signup' : 'signin')}
              className="text-sm text-slate-600 hover:text-emerald-600 font-medium"
            >
              {view === 'signin' ? 'Need an account? Sign Up' : 'Already have an account? Sign In'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};