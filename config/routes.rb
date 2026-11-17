Rails.application.routes.draw do
  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # The hunt's solver token lives in the cookie session, so these routes carry no id.
  resource :hunt, only: %i[ show create destroy ] do
    post :chunk
    get :status
    post :truth
    post :test_flight
  end

  resources :results, only: :index

  root "hunts#show"
end
