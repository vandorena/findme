Rails.application.routes.draw do
  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  resource :profile, only: %i[ show create ]

  # Consented self-portrait mode and its placeholder sign-in.
  resource :self_portrait, only: %i[ show create ]
  resource :session, only: %i[ create destroy ]

  root "profiles#show"
end
