import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './services/supabase';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { GalleryManager } from './pages/GalleryManager';
import { ClientGallery } from './pages/ClientGallery';
import { Session } from '@supabase/supabase-js';
import { UploadProvider } from './contexts/UploadContext';

import { Portfolio } from './pages/Portfolio';
import { Prints } from './pages/Prints';

const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for hash parameters for auth (e.g. access_token, error, type=signup)
    const hash = window.location.hash;
    const isAuthRedirect = hash && (hash.includes('access_token') || hash.includes('error') || hash.includes('type='));

    // If we are NOT processing an auth redirect, we can check the local storage session immediately.
    // If we ARE processing a redirect, we wait for onAuthStateChange to fire to avoid race conditions.
    if (!isAuthRedirect) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setLoading(false);
      }).catch((err) => {
        console.warn("Supabase session check failed:", err);
        setLoading(false);
      });
    }

    // Listen for auth changes (this handles the hash parsing for magic links/confirmations)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-slate-400">Loading...</div>;

  return (
    <UploadProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={!session ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/g/:galleryId" element={<ClientGallery />} />
          <Route path="/p/:photographerId" element={<Portfolio />} />
          <Route path="/prints" element={<Prints />} />

          {/* Protected Photographer Routes */}
          <Route path="/dashboard" element={
            session ? (
              <Layout>
                <Dashboard />
              </Layout>
            ) : <Navigate to="/login" />
          } />
          
          <Route path="/gallery/:id" element={
            session ? (
              <Layout>
                <GalleryManager />
              </Layout>
            ) : <Navigate to="/login" />
          } />

          {/* Default */}
          <Route path="*" element={<Navigate to={session ? "/dashboard" : "/login"} />} />
        </Routes>
      </Router>
    </UploadProvider>
  );
};

export default App;