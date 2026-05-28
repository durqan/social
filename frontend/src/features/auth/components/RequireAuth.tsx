import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from "@/app/providers/AuthContext.js";
import { Spinner } from "@/shared/ui/Spinner.js";

export const RequireAuth = () => {
    const { currentUser, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    if (!currentUser) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return <Outlet />;
};

export const RequireGuest = () => {
    const { currentUser, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    if (currentUser) {
        return <Navigate to={`/users/${currentUser.id}`} replace />;
    }

    return <Outlet />;
};
