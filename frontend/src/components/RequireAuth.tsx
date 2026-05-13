import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { Spinner } from './ui/Spinner.js';

export const RequireAuth = () => {
    const { currentUser, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    if (!currentUser) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return <Outlet />;
};
