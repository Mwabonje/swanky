import React, { useState } from 'react';
import { LogOut, Camera, LayoutDashboard, Loader2, Menu, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useUpload } from '../contexts/UploadContext';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { uploading, progress, cancelUpload } = useUpload();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden bg-white text-zinc-900 p-4 flex justify-between items-center sticky top-0 z-30 border-b border-zinc-200">
        <div className="flex items-center space-x-2">
           <Camera className="w-6 h-6 text-zinc-900" strokeWidth={1} />
           <span className="text-lg font-serif tracking-widest uppercase">Swanky</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
          className="p-2 -mr-2 rounded-md hover:bg-zinc-100 transition-colors"
          aria-label="Toggle menu"
        >
          {isMobileMenuOpen ? <X className="w-6 h-6" strokeWidth={1} /> : <Menu className="w-6 h-6" strokeWidth={1} />}
        </button>
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white text-zinc-900 transform transition-transform duration-300 ease-in-out border-r border-zinc-200
        md:relative md:translate-x-0 flex flex-col justify-between
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div>
          <div className="p-6 hidden md:flex items-center space-x-3 border-b border-zinc-200">
            <Camera className="w-6 h-6 text-zinc-900" strokeWidth={1} />
            <span className="text-xl font-serif tracking-widest text-zinc-900 uppercase">Swanky</span>
          </div>
          
          <nav className="mt-6 px-4 space-y-2">
            <button
              onClick={() => {
                navigate('/dashboard');
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/dashboard') 
                  ? 'bg-zinc-100 text-zinc-900 font-medium' 
                  : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" strokeWidth={1.5} />
              <span>Dashboard</span>
            </button>
            {/* Future settings link could go here */}
          </nav>
        </div>

        <div className="p-4 border-t border-zinc-200 space-y-4">
          {/* Upload Status in Sidebar */}
          {uploading && (
            <div className="bg-zinc-50 rounded-lg p-3 border border-zinc-200">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-zinc-500 font-medium flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin text-zinc-900" />
                        Uploading...
                    </span>
                    <span className="text-xs text-zinc-900 font-bold">{progress}%</span>
                </div>
                <div className="w-full h-1 bg-zinc-200 rounded-full overflow-hidden mb-3">
                    <div 
                        className="h-full bg-zinc-900 transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <button 
                  onClick={cancelUpload}
                  className="w-full text-xs text-center text-red-500 hover:text-red-600 font-medium py-1 hover:bg-zinc-100 rounded transition-colors"
                >
                  Cancel Upload
                </button>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 px-4 py-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" strokeWidth={1.5} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto h-[calc(100vh-64px)] md:h-screen relative bg-zinc-50">
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};