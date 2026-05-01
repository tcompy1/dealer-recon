from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Dealer Recon API"
    app_version: str = "0.1.0"
    environment: str = "local"
    database_url: str = "postgresql+psycopg://dealer_recon:dealer_recon@localhost:5432/dealer_recon"
    upload_storage_path: str = "storage/uploads"
    backend_cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


settings = Settings()
