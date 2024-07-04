import { createContext, useContext, useState } from "react";

export type AuthContextInitialState =
  | {
      isAuthenticated: false;
    }
  | {
      isAuthenticated: true;
      address: string;
    };

export type AuthContextType = AuthContextInitialState & {
  login: (address: string) => void;
  logout: () => void;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({
  children,
  initialValue,
}: { children: React.ReactNode; initialValue: AuthContextInitialState }) {
  const [auth, setAuth] = useState<AuthContextInitialState>(initialValue);

  return (
    <AuthContext.Provider
      value={{
        ...auth,
        login: (address: string) => {
          setAuth({ isAuthenticated: true, address });
        },
        logout: () => {
          setAuth({ isAuthenticated: false });
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
