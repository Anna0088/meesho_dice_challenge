import { useState, useEffect } from 'react';
import {
  Leaf, ShoppingBag, Award, Users, Package, BarChart3,
  Mic, MessageCircle, TrendingUp, Shield, Recycle, Globe
} from 'lucide-react';
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';

// API Base URL
const API_URL = 'http://localhost:3000';

interface Seller {
  id: number;
  name: string;
  tier: string;
  sqs_score: number;
}

function App() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [activeTab, setActiveTab] = useState('marketplace');

  useEffect(() => {
    fetchSellers();
  }, []);

  const fetchSellers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/sellers`);
      setSellers(response.data.sellers);
    } catch (error) {
      console.error('Error fetching sellers:', error);
    }
  };

  const handleVoiceClick = () => {
    setIsListening(!isListening);
    toast.success(isListening ? 'Voice assistant stopped' : 'Listening... Speak now!');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50">
      <Toaster position="top-right" />

      {/* Navigation */}
      <nav className="bg-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Leaf className="text-green-primary h-8 w-8" />
              <span className="text-2xl font-bold bg-gradient-to-r from-green-primary to-leaf-green text-transparent bg-clip-text">
                GreenBharat
              </span>
            </div>

            <div className="flex items-center space-x-6">
              <button
                onClick={() => setActiveTab('marketplace')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeTab === 'marketplace' ? 'bg-eco-mint text-forest-green' : 'hover:bg-gray-100'
                }`}
              >
                Marketplace
              </button>
              <button
                onClick={() => setActiveTab('sellers')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeTab === 'sellers' ? 'bg-eco-mint text-forest-green' : 'hover:bg-gray-100'
                }`}
              >
                Sellers
              </button>
              <button
                onClick={() => setActiveTab('rewards')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeTab === 'rewards' ? 'bg-eco-mint text-forest-green' : 'hover:bg-gray-100'
                }`}
              >
                Rewards
              </button>
              <button className="btn-primary">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-5xl font-bold text-gray-800 mb-6">
              Welcome to <span className="text-green-primary">GreenBharat</span>
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              India's first AI-powered sustainable e-commerce platform.
              Shop responsibly, earn rewards, and make a positive impact on the environment.
            </p>

            <div className="flex space-x-4 mb-8">
              <div className="flex items-center space-x-2">
                <Shield className="text-green-primary h-5 w-5" />
                <span className="text-sm text-gray-600">Verified Green Sellers</span>
              </div>
              <div className="flex items-center space-x-2">
                <Recycle className="text-green-primary h-5 w-5" />
                <span className="text-sm text-gray-600">Eco-Friendly Products</span>
              </div>
              <div className="flex items-center space-x-2">
                <Award className="text-green-primary h-5 w-5" />
                <span className="text-sm text-gray-600">Rewards System</span>
              </div>
            </div>

            <div className="flex space-x-4">
              <button className="btn-primary">
                <ShoppingBag className="inline mr-2 h-5 w-5" />
                Start Shopping
              </button>
              <button className="btn-secondary">
                <Users className="inline mr-2 h-5 w-5" />
                Become a Seller
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="bg-white rounded-2xl shadow-2xl p-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-green-100 to-eco-mint rounded-xl p-6">
                  <Package className="text-forest-green h-8 w-8 mb-2" />
                  <div className="text-3xl font-bold text-forest-green">2M+</div>
                  <div className="text-sm text-gray-600">Eco Products</div>
                </div>
                <div className="bg-gradient-to-br from-blue-100 to-sky-blue/20 rounded-xl p-6">
                  <Users className="text-ocean-blue h-8 w-8 mb-2" />
                  <div className="text-3xl font-bold text-ocean-blue">500K+</div>
                  <div className="text-sm text-gray-600">Green Sellers</div>
                </div>
                <div className="bg-gradient-to-br from-yellow-100 to-sustainable-gold/20 rounded-xl p-6">
                  <Award className="text-clay-orange h-8 w-8 mb-2" />
                  <div className="text-3xl font-bold text-clay-orange">10M+</div>
                  <div className="text-sm text-gray-600">GreenBits Earned</div>
                </div>
                <div className="bg-gradient-to-br from-purple-100 to-purple-200 rounded-xl p-6">
                  <Globe className="text-purple-600 h-8 w-8 mb-2" />
                  <div className="text-3xl font-bold text-purple-600">50T</div>
                  <div className="text-sm text-gray-600">CO₂ Saved</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="container mx-auto px-6 py-12">
        {activeTab === 'marketplace' && (
          <div>
            <h2 className="text-3xl font-bold text-gray-800 mb-8">
              <ShoppingBag className="inline mr-2" />
              GreenBharat Marketplace
            </h2>

            {/* Product Categories */}
            <div className="grid md:grid-cols-4 gap-6 mb-12">
              {['Fashion', 'Electronics', 'Home & Living', 'Beauty'].map((category) => (
                <div key={category} className="card p-6 hover:shadow-xl transition-shadow cursor-pointer">
                  <div className="h-32 bg-gradient-to-br from-eco-mint to-green-primary/20 rounded-lg mb-4"></div>
                  <h3 className="font-semibold text-lg mb-2">{category}</h3>
                  <p className="text-sm text-gray-600">100% Sustainable</p>
                  <div className="mt-4 flex items-center space-x-2">
                    <span className="eco-badge">Eco-Verified</span>
                    <span className="eco-badge">Carbon Neutral</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-8">
              <div className="card p-6 text-center">
                <div className="bg-eco-mint rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Leaf className="text-forest-green h-8 w-8" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Sustainability Score</h3>
                <p className="text-gray-600">
                  Every product comes with an AI-calculated sustainability score
                </p>
              </div>

              <div className="card p-6 text-center">
                <div className="bg-sky-blue/20 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <TrendingUp className="text-ocean-blue h-8 w-8" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Smart Recommendations</h3>
                <p className="text-gray-600">
                  AI-powered suggestions for eco-friendly alternatives
                </p>
              </div>

              <div className="card p-6 text-center">
                <div className="bg-sustainable-gold/20 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Award className="text-clay-orange h-8 w-8" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Earn GreenBits</h3>
                <p className="text-gray-600">
                  Get rewarded for making sustainable choices
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sellers' && (
          <div>
            <h2 className="text-3xl font-bold text-gray-800 mb-8">
              <Users className="inline mr-2" />
              Verified Green Sellers
            </h2>

            <div className="grid md:grid-cols-3 gap-6">
              {sellers.map((seller) => (
                <div key={seller.id} className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg">{seller.name}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      seller.tier === 'verified_brand'
                        ? 'bg-purple-100 text-purple-800'
                        : seller.tier === 'small_business'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {seller.tier.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-600">Sustainability Score</span>
                      <span className="font-bold text-green-primary">{seller.sqs_score}/100</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-green-primary to-leaf-green h-2 rounded-full"
                        style={{ width: `${seller.sqs_score}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <span className="eco-badge">Verified</span>
                    {seller.sqs_score > 80 && <span className="eco-badge">Top Rated</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 card p-8 bg-gradient-to-r from-green-primary to-leaf-green text-white">
              <h3 className="text-2xl font-bold mb-4">Become a Green Seller</h3>
              <p className="mb-6">
                Join thousands of sustainable businesses on GreenBharat.
                Get verified, reach conscious consumers, and grow your eco-friendly business.
              </p>
              <button className="bg-white text-green-primary px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors">
                Apply Now
              </button>
            </div>
          </div>
        )}

        {activeTab === 'rewards' && (
          <div>
            <h2 className="text-3xl font-bold text-gray-800 mb-8">
              <Award className="inline mr-2" />
              GreenBits Rewards Program
            </h2>

            <div className="grid md:grid-cols-2 gap-8 mb-12">
              <div className="card p-8">
                <h3 className="text-xl font-bold mb-6">Your GreenBits Balance</h3>
                <div className="text-5xl font-bold text-green-primary mb-2">12,450</div>
                <p className="text-gray-600 mb-6">Points available for redemption</p>

                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress to Gold Tier</span>
                      <span className="font-semibold">2,450 / 5,000</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div className="bg-gradient-to-r from-sustainable-gold to-clay-orange h-3 rounded-full" style={{ width: '49%' }}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card p-8">
                <h3 className="text-xl font-bold mb-6">Tier Benefits</h3>
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                      <span className="text-amber-600 font-bold">B</span>
                    </div>
                    <div>
                      <div className="font-semibold">Bronze Star</div>
                      <div className="text-sm text-gray-600">5% cashback on eco products</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                      <span className="text-gray-600 font-bold">S</span>
                    </div>
                    <div>
                      <div className="font-semibold">Silver Star (Current)</div>
                      <div className="text-sm text-gray-600">10% cashback + Free shipping</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 opacity-50">
                    <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                      <span className="text-yellow-600 font-bold">G</span>
                    </div>
                    <div>
                      <div className="font-semibold">Gold Star</div>
                      <div className="text-sm text-gray-600">15% cashback + Priority support</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-6">Daily Eco-Challenges</h3>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="card p-6 border-2 border-green-primary">
                  <div className="flex items-center justify-between mb-4">
                    <span className="eco-badge">Active</span>
                    <span className="text-green-primary font-bold">+100 Bits</span>
                  </div>
                  <h4 className="font-semibold mb-2">Green Shopping Spree</h4>
                  <p className="text-sm text-gray-600 mb-4">Purchase 3 eco-certified products</p>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-primary h-2 rounded-full" style={{ width: '33%' }}></div>
                  </div>
                  <span className="text-xs text-gray-500 mt-2 block">1/3 completed</span>
                </div>

                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="eco-badge">New</span>
                    <span className="text-green-primary font-bold">+50 Bits</span>
                  </div>
                  <h4 className="font-semibold mb-2">Review & Rate</h4>
                  <p className="text-sm text-gray-600 mb-4">Write a review for your recent purchase</p>
                  <button className="btn-primary w-full text-sm">Start Challenge</button>
                </div>

                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="eco-badge">Bonus</span>
                    <span className="text-green-primary font-bold">+200 Bits</span>
                  </div>
                  <h4 className="font-semibold mb-2">Refer a Friend</h4>
                  <p className="text-sm text-gray-600 mb-4">Invite friends to join GreenBharat</p>
                  <button className="btn-primary w-full text-sm">Share Now</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Voice Assistant Button */}
      <button
        onClick={handleVoiceClick}
        className={`fixed bottom-8 right-8 p-4 rounded-full shadow-2xl transition-all ${
          isListening
            ? 'bg-red-500 animate-pulse'
            : 'bg-gradient-to-r from-green-primary to-leaf-green hover:scale-110'
        }`}
      >
        {isListening ? (
          <MessageCircle className="text-white h-6 w-6" />
        ) : (
          <Mic className="text-white h-6 w-6" />
        )}
      </button>

      {/* Footer */}
      <footer className="bg-forest-green text-white mt-20">
        <div className="container mx-auto px-6 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Leaf className="h-8 w-8" />
                <span className="text-xl font-bold">GreenBharat</span>
              </div>
              <p className="text-green-100">
                Building a sustainable future through conscious commerce
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Platform</h4>
              <ul className="space-y-2 text-green-100">
                <li>Marketplace</li>
                <li>Green Sellers</li>
                <li>Sustainability Score</li>
                <li>AI Assistant</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-green-100">
                <li>About Us</li>
                <li>Impact Report</li>
                <li>Careers</li>
                <li>Blog</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Connect</h4>
              <ul className="space-y-2 text-green-100">
                <li>Contact Support</li>
                <li>Partner with Us</li>
                <li>Developer API</li>
                <li>Community</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-green-700 mt-8 pt-8 text-center text-green-100">
            <p>&copy; 2025 GreenBharat (Meesho Ecosystem). All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;